import { z } from "zod";
import path from "path";
import fs from "fs";

function readJsonIfExists(filePath: string): Record<string, unknown> | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function loadCrashpointConfigObject(): Record<string, unknown> {
  if (process.env.CRASHPOINT_CONFIG_PATH) {
    return readJsonIfExists(process.env.CRASHPOINT_CONFIG_PATH) ?? {};
  }
  const parentDir = process.env.CRASH_ANALYSIS_PARENT;
  if (parentDir) {
    const configPath = path.join(parentDir, "crashpoint.config.json");
    return readJsonIfExists(configPath) ?? {};
  }
  return {};
}

const envSchema = z.object({
  CRASH_ANALYSIS_PARENT: z.string().min(1).describe("Path to ParentHolderFolder"),
  CLAUDE_CLI_PATH: z.string().optional().describe("Absolute path to the Claude CLI binary"),
  DSYM_PATH: z.string().optional().describe("Path to MyApp.dSYM"),
  APP_PATH: z.string().optional().describe("Path to MyApp.app"),
  APP_NAME: z.string().optional().describe("App binary name e.g. MyApp"),
  CRASH_INPUT_DIR: z.string().optional().describe("Override .xccrashpoint search dir"),
  CRASH_VERSIONS: z.string().optional().describe("Comma-separated version filter"),
  CRASH_NUM_DAYS: z.string().optional().describe("Number of days to process (1–180, default: 1)"),
  CRASH_DATE_OFFSET: z.string().optional().describe("Days offset from today for end date (default: 4)"),
  MASTER_BRANCH_PATH: z.string().optional().describe("Path to current master/live branch checkout"),
  DEV_BRANCH_PATH: z.string().optional().describe("Path to current development branch checkout"),

  // Zoho Cliq
  ZOHO_CLIQ_WEBHOOK_URL: z.string().optional().describe("Zoho Cliq channel incoming webhook URL"),

  // Zoho Projects integration
  ZOHO_PROJECTS_PORTAL_ID: z.string().optional().describe("Zoho Projects portal ID"),
  ZOHO_PROJECTS_PROJECT_ID: z.string().optional().describe("Zoho Projects project ID"),

  // Bug status IDs
  ZOHO_BUG_STATUS_OPEN: z.string().optional().describe("Zoho bug status ID for Open"),
  ZOHO_BUG_STATUS_FIXED: z.string().optional().describe("Zoho bug status ID for Fixed"),

  // Bug severity IDs
  ZOHO_BUG_SEVERITY_SHOWSTOPPER: z.string().optional().describe("Severity ID: Showstopper"),
  ZOHO_BUG_SEVERITY_CRITICAL: z.string().optional().describe("Severity ID: Critical"),
  ZOHO_BUG_SEVERITY_MAJOR: z.string().optional().describe("Severity ID: Major"),
  ZOHO_BUG_SEVERITY_MINOR: z.string().optional().describe("Severity ID: Minor"),
  ZOHO_BUG_SEVERITY_NONE: z.string().optional().describe("Severity ID: None"),

  // Custom fields
  ZOHO_BUG_APP_VERSION: z.string().optional().describe("Custom field name for app version on Zoho Projects bugs"),
  ZOHO_BUG_NUM_OF_OCCURRENCES: z.string().optional().describe("Custom field name for number of occurrences on Zoho Projects bugs"),

  // App display name
  APP_DISPLAY_NAME: z.string().optional().describe("Display name of the app. Used in pipeline prompts and Cliq notifications."),

  // MCP server name
  APPTICS_MCP_NAME: z.string().optional().describe("Name of the Apptics MCP server as it appears in Claude's connector list"),

  // Apptics project identifiers
  APPTICS_PORTAL_ID: z.string().optional().describe("Apptics portal ID (zsoid)"),
  APPTICS_PROJECT_ID: z.string().optional().describe("Apptics project ID"),
  APPTICS_APP_NAME: z.string().optional().describe("App name as it appears in Apptics"),
});

export type CrashPointConfig = z.infer<typeof envSchema>;

let cachedConfig: CrashPointConfig | undefined;

export function getConfig(): CrashPointConfig {
  if (!cachedConfig) {
    const fileCfg = loadCrashpointConfigObject();
    cachedConfig = envSchema.parse({ ...fileCfg, ...process.env });
  }
  return cachedConfig;
}

export function getMainCrashLogsDir(config: CrashPointConfig): string {
  return path.join(config.CRASH_ANALYSIS_PARENT, "MainCrashLogsFolder");
}

export function getXcodeCrashesDir(config: CrashPointConfig): string {
  return path.join(config.CRASH_ANALYSIS_PARENT, "MainCrashLogsFolder", "XCodeCrashLogs");
}

export function getAppticsCrashesDir(config: CrashPointConfig): string {
  return path.join(config.CRASH_ANALYSIS_PARENT, "MainCrashLogsFolder", "AppticsCrashLogs");
}

export function getOtherCrashesDir(config: CrashPointConfig): string {
  return path.join(config.CRASH_ANALYSIS_PARENT, "MainCrashLogsFolder", "OtherCrashLogs");
}

export function getSymbolicatedDir(config: CrashPointConfig): string {
  return path.join(config.CRASH_ANALYSIS_PARENT, "SymbolicatedCrashLogsFolder");
}

export function getAnalyzedReportsDir(config: CrashPointConfig): string {
  return path.join(config.CRASH_ANALYSIS_PARENT, "AnalyzedReportsFolder");
}

export function getStateMaintenanceDir(config: CrashPointConfig): string {
  return path.join(config.CRASH_ANALYSIS_PARENT, "StateMaintenance");
}

export function getAutomationDir(config: CrashPointConfig): string {
  return path.join(config.CRASH_ANALYSIS_PARENT, "Automation");
}

export function getLatestJsonReportPath(config: CrashPointConfig): string {
  return path.join(getAnalyzedReportsDir(config), "latest.json");
}

export function getLatestCsvReportPath(config: CrashPointConfig): string {
  return path.join(getAnalyzedReportsDir(config), "latest.csv");
}

export function hasCrashFiles(dir: string): boolean {
  return (
    fs.existsSync(dir) &&
    fs.readdirSync(dir).some((f) => f.endsWith(".crash") || f.endsWith(".ips"))
  );
}

export function getSeverityId(config: CrashPointConfig, count: number): string | undefined {
  if (count >= 50) return config.ZOHO_BUG_SEVERITY_SHOWSTOPPER;
  if (count >= 20) return config.ZOHO_BUG_SEVERITY_CRITICAL;
  if (count >= 5) return config.ZOHO_BUG_SEVERITY_MAJOR;
  if (count >= 2) return config.ZOHO_BUG_SEVERITY_MINOR;
  return config.ZOHO_BUG_SEVERITY_NONE;
}
