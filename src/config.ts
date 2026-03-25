import dotenv from "dotenv";
import { z } from "zod";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.resolve(__dirname, "..", ".env"), quiet: true });

const envSchema = z.object({
  CRASH_ANALYSIS_PARENT: z.string().min(1).describe("Path to ParentHolderFolder"),
  DSYM_PATH: z.string().optional().describe("Path to MyApp.dSYM"),
  APP_PATH: z.string().optional().describe("Path to MyApp.app"),
  APP_NAME: z.string().optional().describe("App binary name e.g. MyApp"),
  CRASH_INPUT_DIR: z.string().optional().describe("Override .xccrashpoint search dir"),
  CRASH_VERSIONS: z.string().optional().describe("Comma-separated version filter"),
  ZOHO_CLIQ_WEBHOOK_URL: z.string().url().optional().describe("Cliq channel webhook URL"),
  MASTER_BRANCH_PATH: z.string().optional().describe("Path to current master/live branch checkout"),
  DEV_BRANCH_PATH: z.string().optional().describe("Path to current development branch checkout"),
  ZOHO_PROJECTS_MCP_URL: z.string().url().optional().describe("Zoho Projects MCP server URL"),
  ZOHO_PROJECTS_PORTAL_ID: z.string().optional().describe("Zoho Projects portal ID"),
  ZOHO_PROJECTS_PROJECT_ID: z.string().optional().describe("Zoho Projects project ID"),
  ZOHO_BUG_STATUS_OPEN: z.string().optional().describe("Zoho bug status field value ID for Open"),
  ZOHO_BUG_STATUS_FIXED: z.string().optional().describe("Zoho bug status field value ID for Fixed"),
  ZOHO_BUG_SEVERITY_SHOWSTOPPER: z.string().optional().describe("Zoho bug severity field value ID for ShowStopper"),
  ZOHO_BUG_SEVERITY_CRITICAL: z.string().optional().describe("Zoho bug severity field value ID for Critical"),
  ZOHO_BUG_SEVERITY_MAJOR: z.string().optional().describe("Zoho bug severity field value ID for Major"),
  ZOHO_BUG_SEVERITY_MINOR: z.string().optional().describe("Zoho bug severity field value ID for Minor"),
  ZOHO_BUG_SEVERITY_NONE: z.string().optional().describe("Zoho bug severity field value ID for None"),
  ZOHO_BUG_CF_OCCURRENCES: z.string().optional().describe("Zoho bug custom field ID for number of crash occurrences"),
  ZOHO_BUG_CF_APP_VERSION: z.string().optional().describe("Zoho bug custom field ID for App Version"),
});

export type CrashPointConfig = z.infer<typeof envSchema>;

let cachedConfig: CrashPointConfig | undefined;

export function getConfig(): CrashPointConfig {
  if (!cachedConfig) {
    cachedConfig = envSchema.parse(process.env);
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

export function hasCrashFiles(dir: string): boolean {
  return (
    fs.existsSync(dir) &&
    fs.readdirSync(dir).some((f) => f.endsWith(".crash") || f.endsWith(".ips"))
  );
}
