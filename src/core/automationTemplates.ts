import os from "os";
import path from "path";

export interface FullCrashPointConfig {
  CRASH_ANALYSIS_PARENT: string;
  CLAUDE_CLI_PATH?: string;
  DSYM_PATH?: string;
  MASTER_BRANCH_PATH?: string;
  DEV_BRANCH_PATH?: string;
  CRASH_VERSIONS?: string;
  CRASH_NUM_DAYS?: string;
  CRASH_DATE_OFFSET?: string;
  CRASH_INPUT_DIR?: string;
  APP_DISPLAY_NAME?: string;
  APPTICS_MCP_NAME?: string;
  APPTICS_PORTAL_ID?: string;
  APPTICS_PROJECT_ID?: string;
  APPTICS_APP_NAME?: string;
  ZOHO_CLIQ_WEBHOOK_URL?: string;
  ZOHO_PROJECTS_PORTAL_ID?: string;
  ZOHO_PROJECTS_PROJECT_ID?: string;
  ZOHO_BUG_STATUS_OPEN?: string;
  ZOHO_BUG_STATUS_FIXED?: string;
  ZOHO_BUG_SEVERITY_SHOWSTOPPER?: string;
  ZOHO_BUG_SEVERITY_CRITICAL?: string;
  ZOHO_BUG_SEVERITY_MAJOR?: string;
  ZOHO_BUG_SEVERITY_MINOR?: string;
  ZOHO_BUG_SEVERITY_NONE?: string;
  ZOHO_BUG_APP_VERSION?: string;
  ZOHO_BUG_NUM_OF_OCCURRENCES?: string;
  SCHEDULED_RUN_TIME?: string;
}

export function generateMcpJson(config: FullCrashPointConfig): string {
  // Only CRASH_ANALYSIS_PARENT is needed as an env var — it bootstraps config
  // loading by pointing the server to crashpoint.config.json. All other values
  // are read from that config file at runtime.
  const json = {
    mcpServers: {
      "crashpoint-ios": {
        command: "npx",
        args: ["-p", "github:maanasa-s-5539/CrashPoint-IOS-MCP", "crashpoint-ios-core"],
        env: {
          CRASH_ANALYSIS_PARENT: config.CRASH_ANALYSIS_PARENT,
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
