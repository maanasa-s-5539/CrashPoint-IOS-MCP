import os from "os";
import path from "path";

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
