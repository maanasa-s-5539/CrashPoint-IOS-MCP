export interface AutomationTemplate {
  filename: string;
  content: string;
  executable: boolean;
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
PROJECTS_MCP_NAME=$(node -e "console.log(require(process.argv[1]).PROJECTS_MCP_NAME || '')" "$CONFIG_JSON")
CRASH_VERSIONS=$(node -e "console.log(require(process.argv[1]).CRASH_VERSIONS || '')" "$CONFIG_JSON")

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

# ─── CLAUDE CLI PATH ──────────────────────────────────────────────────────────
# Edit this to the path of your Claude CLI binary
CLAUDE_PATH="<REPLACE_WITH_CLAUDE_CLI_PATH>"

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
  -e "s|{{PROJECTS_MCP_NAME}}|\${PROJECTS_MCP_NAME}|g" \\
  -e "s|{{CRASH_VERSIONS}}|\${CRASH_VERSIONS}|g" \\
  -e "s|{{TARGET_DATE}}|\${TARGET_DATE}|g" \\
  "$PROMPT_FILE")

# ─── BUILD --allowedTools DYNAMICALLY FROM config file MCP NAMES ─────────────
ALLOWED_TOOLS="mcp__crashpoint-ios__*,mcp__crashpoint-integrations__*,mcp__claude_ai_\${APPTICS_MCP_NAME}__*,mcp__claude_ai_\${PROJECTS_MCP_NAME}__*"

# ─── TIMESTAMP & LOG FILE ─────────────────────────────────────────────────────
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="$LOG_DIR/pipeline_\${TIMESTAMP}.log"

{
  echo "=== Crash Pipeline Run: \$TIMESTAMP ==="
  echo "App:           \${APP_DISPLAY_NAME}"
  echo "Version:       \${CRASH_VERSIONS}"
  echo "Target Date:   \${TARGET_DATE} (offset: \${CRASH_DATE_OFFSET} days)"
  echo "Apptics MCP:   \${APPTICS_MCP_NAME}"
  echo "Projects MCP:  \${PROJECTS_MCP_NAME}"
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
Use the Crashpoint-integrations-mcp and {{PROJECTS_MCP_NAME}} MCPs and the latest report. Use the portal id, project id and field id values from the config file. Use these tools from {{PROJECTS_MCP_NAME}} MCP : getProjectsIssues, createProjectIssue, updateIssue.
If an issue with the same crash signature and app version number does not exist already, create a new issue, setting the App Version and Number of Occurrences field values.
If an issue with the same crash signature exists already, update the existing crash's number of occurrences. Take the existing value in the number of occurrences field, add the new number of occurrences to it and update the field.

After completing all steps, output a summary of what was processed.
`;

const MCP_JSON_EXAMPLE = `{
  "mcpServers": {
    "crashpoint-ios": {
      "command": "npx",
      "args": ["-p", "github:maanasa-s-5539/CrashPoint-IOS-MCP", "crashpoint-ios-core"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "{{PARENT_HOLDER_FOLDER}}",
        "DSYM_PATH": "<REPLACE_WITH_DSYM_PATH>",
        "APP_PATH": "<REPLACE_WITH_APP_PATH>",
        "APP_NAME": "<REPLACE_WITH_APP_NAME>",
        "MASTER_BRANCH_PATH": "<REPLACE_WITH_MASTER_BRANCH_PATH>",
        "DEV_BRANCH_PATH": "<REPLACE_WITH_DEV_BRANCH_PATH>"
      }
    },
    "crashpoint-integrations": {
      "command": "npx",
      "args": ["-p", "github:maanasa-s-5539/CrashPoint-Integrations-MCP", "crashpoint-integrations"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "{{PARENT_HOLDER_FOLDER}}",
        "ZOHO_CLIQ_WEBHOOK_URL": "<REPLACE_WITH_CLIQ_WEBHOOK_URL>",
        "ZOHO_PROJECTS_PORTAL_ID": "<REPLACE_WITH_PORTAL_ID>",
        "ZOHO_PROJECTS_PROJECT_ID": "<REPLACE_WITH_PROJECT_ID>",
        "ZOHO_BUG_STATUS_OPEN": "<REPLACE_WITH_STATUS_ID>",
        "ZOHO_BUG_APP_VERSION": "<REPLACE_WITH_FIELD_NAME>",
        "ZOHO_BUG_NUM_OF_OCCURRENCES": "<REPLACE_WITH_FIELD_NAME>",
        "CRASH_VERSIONS": "<REPLACE_WITH_APP_VERSION>"
      }
    }
  }
}
`;

const COM_CRASHPIPELINE_DAILY_PLIST_EXAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.crashpipeline.daily_mcp</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string><REPLACE_WITH_PATH_TO>/automation/run_crash_pipeline.sh</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
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
        <string><REPLACE_WITH_HOME_DIR></string>
    </dict>
</dict>
</plist>
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
    {
      filename: ".mcp.json.example",
      content: fill(MCP_JSON_EXAMPLE),
      executable: false,
    },
    {
      filename: "com.crashpipeline.daily_mcp.plist.example",
      content: COM_CRASHPIPELINE_DAILY_PLIST_EXAMPLE,
      executable: false,
    },
  ];
}
