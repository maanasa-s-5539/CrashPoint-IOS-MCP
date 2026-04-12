import os from "os";
import path from "path";

export interface AutomationTemplate {
  filename: string;
  content: string;
  executable: boolean;
}

export interface FullCrashPointConfig {
  CRASH_ANALYSIS_PARENT: string;
  CLAUDE_CLI_PATH?: string;
  DSYM_PATH?: string;
  APP_PATH?: string;
  APP_NAME?: string;
  MASTER_BRANCH_PATH?: string;
  DEV_BRANCH_PATH?: string;
  CRASH_VERSIONS?: string;
  CRASH_DATE_OFFSET?: string;
  APP_DISPLAY_NAME?: string;
  APPTICS_MCP_NAME?: string;
  ZOHO_CLIQ_WEBHOOK_URL?: string;
  ZOHO_PROJECTS_PORTAL_ID?: string;
  ZOHO_PROJECTS_PROJECT_ID?: string;
  ZOHO_BUG_STATUS_OPEN?: string;
  ZOHO_BUG_APP_VERSION?: string;
  ZOHO_BUG_NUM_OF_OCCURRENCES?: string;
  SCHEDULED_RUN_TIME?: string;
}

export function generateMcpJson(config: FullCrashPointConfig): string {
  const getConfigValue = (k: keyof FullCrashPointConfig): string => (config[k] as string | undefined) ?? "";
  const json = {
    mcpServers: {
      "crashpoint-ios": {
        command: "npx",
        args: ["-p", "github:maanasa-s-5539/CrashPoint-IOS-MCP", "crashpoint-ios-core"],
        env: {
          CRASH_ANALYSIS_PARENT: getConfigValue("CRASH_ANALYSIS_PARENT"),
          DSYM_PATH: getConfigValue("DSYM_PATH"),
          APP_PATH: getConfigValue("APP_PATH"),
          APP_NAME: getConfigValue("APP_NAME"),
          MASTER_BRANCH_PATH: getConfigValue("MASTER_BRANCH_PATH"),
          DEV_BRANCH_PATH: getConfigValue("DEV_BRANCH_PATH"),
        },
      },
      "crashpoint-integrations": {
        command: "npx",
        args: ["-p", "github:maanasa-s-5539/CrashPoint-Integrations-MCP", "crashpoint-integrations"],
        env: {
          CRASH_ANALYSIS_PARENT: getConfigValue("CRASH_ANALYSIS_PARENT"),
          ZOHO_CLIQ_WEBHOOK_URL: getConfigValue("ZOHO_CLIQ_WEBHOOK_URL"),
          ZOHO_PROJECTS_PORTAL_ID: getConfigValue("ZOHO_PROJECTS_PORTAL_ID"),
          ZOHO_PROJECTS_PROJECT_ID: getConfigValue("ZOHO_PROJECTS_PROJECT_ID"),
          ZOHO_BUG_STATUS_OPEN: getConfigValue("ZOHO_BUG_STATUS_OPEN"),
          ZOHO_BUG_APP_VERSION: getConfigValue("ZOHO_BUG_APP_VERSION"),
          ZOHO_BUG_NUM_OF_OCCURRENCES: getConfigValue("ZOHO_BUG_NUM_OF_OCCURRENCES"),
          CRASH_VERSIONS: getConfigValue("CRASH_VERSIONS"),
        },
      },
    },
  };
  return JSON.stringify(json, null, 2);
}

export function generatePlist(config: FullCrashPointConfig): string {
  const scriptPath = path.join(config.CRASH_ANALYSIS_PARENT, "Automation", "run_crash_pipeline.sh");
  const homeDir = os.homedir();
  const scheduledRunTime = config.SCHEDULED_RUN_TIME ?? "11:00";
  const timeParts = scheduledRunTime.split(":");
  const parsedHour = parseInt(timeParts[0] ?? "11", 10);
  const parsedMinute = parseInt(timeParts[1] ?? "0", 10);
  const hour = (!isNaN(parsedHour) && parsedHour >= 0 && parsedHour <= 23) ? parsedHour : 11;
  const minute = (!isNaN(parsedMinute) && parsedMinute >= 0 && parsedMinute <= 59) ? parsedMinute : 0;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.crashpipeline.daily_mcp</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${scriptPath}</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>${hour}</integer>
        <key>Minute</key>
        <integer>${minute}</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>/tmp/crashpipeline_stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/crashpipeline_stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
        <key>HOME</key>
        <string>${homeDir}</string>
    </dict>
</dict>
</plist>`;
}

const RUN_CRASH_PIPELINE_SH = `#!/bin/bash
set -euo pipefail

# ─── DERIVE PATHS FROM SCRIPT LOCATION ───────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── LOGS ─────────────────────────────────────────────────────────────────────
LOG_DIR="$SCRIPT_DIR/ScheduledRunLogs"
mkdir -p "$LOG_DIR"

# ─── LOAD CONFIG FILE ─────────────────────────────────────────────────────────
PARENT_HOLDER_FOLDER="{{PARENT_HOLDER_FOLDER}}"
CONFIG_JSON="$PARENT_HOLDER_FOLDER/crashpoint.config.json"

if [ ! -f "$CONFIG_JSON" ]; then
  echo "ERROR: Config file not found at $CONFIG_JSON"
  exit 1
fi

# Validate that the config file contains valid JSON
if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$CONFIG_JSON" 2>/dev/null; then
  echo "ERROR: Config file at $CONFIG_JSON contains invalid JSON"
  exit 1
fi

# Read automation variables FROM config file
APP_DISPLAY_NAME=$(node -e "console.log(require(process.argv[1]).APP_DISPLAY_NAME || '')" "$CONFIG_JSON")
APPTICS_MCP_NAME=$(node -e "console.log(require(process.argv[1]).APPTICS_MCP_NAME || '')" "$CONFIG_JSON")
CRASH_VERSIONS=$(node -e "console.log(require(process.argv[1]).CRASH_VERSIONS || '')" "$CONFIG_JSON")
SCHEDULED_RUN_TIME=$(node -e "console.log(require(process.argv[1]).SCHEDULED_RUN_TIME || '11:00')" "$CONFIG_JSON")
IFS=':' read -r SCHED_HOUR SCHED_MINUTE <<< "$SCHEDULED_RUN_TIME"
SCHED_HOUR=$((10#\${SCHED_HOUR:-11}))
SCHED_MINUTE=$((10#\${SCHED_MINUTE:-0}))
if [ "$SCHED_HOUR" -lt 0 ] || [ "$SCHED_HOUR" -gt 23 ] || [ "$SCHED_MINUTE" -lt 0 ] || [ "$SCHED_MINUTE" -gt 59 ]; then
  echo "WARNING: SCHEDULED_RUN_TIME '$SCHEDULED_RUN_TIME' is invalid, defaulting to 11:00"
  SCHED_HOUR=11
  SCHED_MINUTE=0
fi

# ─── CLAUDE CLI PATH ──────────────────────────────────────────────────────────
CLAUDE_PATH=$(node -e "console.log(require(process.argv[1]).CLAUDE_CLI_PATH || '')" "$CONFIG_JSON")
if [ -z "$CLAUDE_PATH" ]; then
  echo "ERROR: CLAUDE_CLI_PATH not set in $CONFIG_JSON"
  exit 1
fi

# ─── PRE-STEP: Clear latest report pointer copies only ───────────────────────
# Removes ONLY latest.json/latest.csv (the stable pointers/copies)
# Keeps all timestamped history (jsonReport_<ts>.json, sheetReport_<ts>.csv)
ANALYZED_DIR="$PARENT_HOLDER_FOLDER/AnalyzedReportsFolder"
LATEST_JSON="$ANALYZED_DIR/latest.json"
LATEST_CSV="$ANALYZED_DIR/latest.csv"

if [ -f "$LATEST_JSON" ]; then
  rm -f "$LATEST_JSON"
  echo "Cleared $LATEST_JSON"
fi
if [ -f "$LATEST_CSV" ]; then
  rm -f "$LATEST_CSV"
  echo "Cleared $LATEST_CSV"
fi

mkdir -p "$ANALYZED_DIR"

# ─── PRE-STEP: Generate .mcp.json if not already present ─────────────────────
MCP_JSON_FILE="$PARENT_HOLDER_FOLDER/.mcp.json"
if [ ! -f "$MCP_JSON_FILE" ]; then
  echo "Generating $MCP_JSON_FILE from $CONFIG_JSON..."
  _DSYM_PATH=$(node -e "console.log(require(process.argv[1]).DSYM_PATH || '')" "$CONFIG_JSON")
  _APP_PATH=$(node -e "console.log(require(process.argv[1]).APP_PATH || '')" "$CONFIG_JSON")
  _APP_NAME=$(node -e "console.log(require(process.argv[1]).APP_NAME || '')" "$CONFIG_JSON")
  _MASTER_BRANCH=$(node -e "console.log(require(process.argv[1]).MASTER_BRANCH_PATH || '')" "$CONFIG_JSON")
  _DEV_BRANCH=$(node -e "console.log(require(process.argv[1]).DEV_BRANCH_PATH || '')" "$CONFIG_JSON")
  _CLIQ_URL=$(node -e "console.log(require(process.argv[1]).ZOHO_CLIQ_WEBHOOK_URL || '')" "$CONFIG_JSON")
  _PORTAL_ID=$(node -e "console.log(require(process.argv[1]).ZOHO_PROJECTS_PORTAL_ID || '')" "$CONFIG_JSON")
  _PROJECT_ID=$(node -e "console.log(require(process.argv[1]).ZOHO_PROJECTS_PROJECT_ID || '')" "$CONFIG_JSON")
  _STATUS_ID=$(node -e "console.log(require(process.argv[1]).ZOHO_BUG_STATUS_OPEN || '')" "$CONFIG_JSON")
  _APP_VER_FIELD=$(node -e "console.log(require(process.argv[1]).ZOHO_BUG_APP_VERSION || '')" "$CONFIG_JSON")
  _OCC_FIELD=$(node -e "console.log(require(process.argv[1]).ZOHO_BUG_NUM_OF_OCCURRENCES || '')" "$CONFIG_JSON")
  cat > "$MCP_JSON_FILE" << MCP_JSON_EOF
{
  "mcpServers": {
    "crashpoint-ios": {
      "command": "npx",
      "args": ["-p", "github:maanasa-s-5539/CrashPoint-IOS-MCP", "crashpoint-ios-core"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "$PARENT_HOLDER_FOLDER",
        "DSYM_PATH": "$_DSYM_PATH",
        "APP_PATH": "$_APP_PATH",
        "APP_NAME": "$_APP_NAME",
        "MASTER_BRANCH_PATH": "$_MASTER_BRANCH",
        "DEV_BRANCH_PATH": "$_DEV_BRANCH"
      }
    },
    "crashpoint-integrations": {
      "command": "npx",
      "args": ["-p", "github:maanasa-s-5539/CrashPoint-Integrations-MCP", "crashpoint-integrations"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "$PARENT_HOLDER_FOLDER",
        "ZOHO_CLIQ_WEBHOOK_URL": "$_CLIQ_URL",
        "ZOHO_PROJECTS_PORTAL_ID": "$_PORTAL_ID",
        "ZOHO_PROJECTS_PROJECT_ID": "$_PROJECT_ID",
        "ZOHO_BUG_STATUS_OPEN": "$_STATUS_ID",
        "ZOHO_BUG_APP_VERSION": "$_APP_VER_FIELD",
        "ZOHO_BUG_NUM_OF_OCCURRENCES": "$_OCC_FIELD",
        "CRASH_VERSIONS": "$CRASH_VERSIONS"
      }
    }
  }
}
MCP_JSON_EOF
  echo "Generated $MCP_JSON_FILE"
fi

# ─── PRE-STEP: Generate launchd plist if not already present ─────────────────
PLIST_FILE="$HOME/Library/LaunchAgents/com.crashpipeline.daily_mcp.plist"
if [ ! -f "$PLIST_FILE" ]; then
  echo "Generating $PLIST_FILE..."
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST_FILE" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.crashpipeline.daily_mcp</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/run_crash_pipeline.sh</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>$SCHED_HOUR</integer>
        <key>Minute</key>
        <integer>$SCHED_MINUTE</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>/tmp/crashpipeline_stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/crashpipeline_stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
</dict>
</plist>
PLIST_EOF
  launchctl load "$PLIST_FILE" 2>/dev/null || true
  echo "Generated and loaded $PLIST_FILE"
fi

# ─── PROMPT TEMPLATE ─────────────────────────────────────────────────────────
PROMPT_FILE="$SCRIPT_DIR/daily_crash_pipeline_prompt.md"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "ERROR: Prompt template not found at $PROMPT_FILE"
  exit 1
fi

if [ ! -x "$CLAUDE_PATH" ]; then
  echo "ERROR: Claude CLI not found or not executable at $CLAUDE_PATH"
  exit 1
fi

# ─── COMPUTE TARGET DATE (N days ago, macOS date syntax) ─────────────────────
CRASH_DATE_OFFSET=$(node -e "console.log(require(process.argv[1]).CRASH_DATE_OFFSET || '3')" "$CONFIG_JSON")
TARGET_DATE=$(date -v-\${CRASH_DATE_OFFSET}d +"%Y-%m-%d")

# ─── SUBSTITUTE PLACEHOLDERS FROM config file ────────────────────────────────
PROMPT=$(sed \\
  -e "s|{{APP_DISPLAY_NAME}}|\${APP_DISPLAY_NAME}|g" \\
  -e "s|{{APPTICS_MCP_NAME}}|\${APPTICS_MCP_NAME}|g" \\
  -e "s|{{CRASH_VERSIONS}}|\${CRASH_VERSIONS}|g" \\
  -e "s|{{TARGET_DATE}}|\${TARGET_DATE}|g" \\
  "$PROMPT_FILE")

# ─── BUILD --allowedTools DYNAMICALLY FROM config file MCP NAMES ─────────────
ALLOWED_TOOLS="mcp__crashpoint-ios__*,mcp__crashpoint-integrations__*,mcp__\${APPTICS_MCP_NAME}__*"

# ─── TIMESTAMP & LOG FILE ─────────────────────────────────────────────────────
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="$LOG_DIR/pipeline_\${TIMESTAMP}.log"

{
  echo "=== Crash Pipeline Run: \$TIMESTAMP ==="
  echo "App:           \${APP_DISPLAY_NAME}"
  echo "Version:       \${CRASH_VERSIONS}"
  echo "Target Date:   \${TARGET_DATE} (offset: \${CRASH_DATE_OFFSET} days)"
  echo "Apptics MCP:   \${APPTICS_MCP_NAME}"
  echo "Allowed Tools: \${ALLOWED_TOOLS}"
  echo "---"
} | tee "$LOG_FILE"

# ─── cd INTO ParentHolderFolder (so Claude picks up .mcp.json) ───────────────
cd "$PARENT_HOLDER_FOLDER"

# ─── RUN PIPELINE ─────────────────────────────────────────────────────────────
"\$CLAUDE_PATH" -p "\$PROMPT" \\
  --allowedTools "\$ALLOWED_TOOLS" \\
  --max-turns 30 \\
  2>&1 | tee -a "\$LOG_FILE"

EXIT_CODE=\${PIPESTATUS[0]}

if [ "\$EXIT_CODE" -ne 0 ]; then
  echo "ERROR: Pipeline failed with exit code \$EXIT_CODE" | tee -a "\$LOG_FILE"
fi

echo "=== Pipeline Complete ===" | tee -a "\$LOG_FILE"
exit "\$EXIT_CODE"
`;

const DAILY_CRASH_PIPELINE_PROMPT_MD = `You are running an automated daily crash analysis pipeline. Execute these steps in order, stopping if any step fails:

## Step 1: Download Crashes from Apptics
Use the {{APPTICS_MCP_NAME}} MCP server. Fetch all crashes and crash details for {{APP_DISPLAY_NAME}} iOS app, for the version number {{CRASH_VERSIONS}} from {{TARGET_DATE}} only (a single day). Save the crash details to 'AppticsCrash_<number>.crash' text files in 'AppticsCrashLogs/' directory.

## Step 2: Export Crash Logs
Use CrashPoint-IOS-MCP to run the full pipeline with startDate={{TARGET_DATE}} and endDate={{TARGET_DATE}} so only crashes from that single day are exported.

## Step 3: Notify Cliq
Use the Crashpoint-integrations-mcp. Using the analyzed latest.json inside ParentHolderFolder -> AnalyzedReportsFolder , notify_cliq about all the crashes from the latest report.

## Step 4: Create/Update Bugs in Zoho Projects
Use the Crashpoint-integrations-mcp and {{APPTICS_MCP_NAME}} MCPs and the latest report. Use the portal id, project id and field id values from the config file. Use these tools from {{APPTICS_MCP_NAME}} MCP : list_bugs, create_bug, update_bug.
If an issue with the same crash signature and app version number does not exist already, create a new issue, setting the App Version and Number of Occurrences field values.
If an issue with the same crash signature exists already, update the existing crash's number of occurrences. Take the existing value in the number of occurrences field, add the new number of occurrences to it and update the field.

After completing all steps, output a summary of what was processed.
`;

export function getAutomationTemplates(parentDir: string): AutomationTemplate[] {
  const fill = (content: string) => content.replaceAll("{{PARENT_HOLDER_FOLDER}}", parentDir);

  return [
    {
      filename: "run_crash_pipeline.sh",
      content: fill(RUN_CRASH_PIPELINE_SH),
      executable: true,
    },
    {
      filename: "daily_crash_pipeline_prompt.md",
      content: DAILY_CRASH_PIPELINE_PROMPT_MD,
      executable: false,
    },
  ];
}
