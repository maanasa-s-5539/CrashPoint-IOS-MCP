import dotenv from "dotenv";
import { z } from "zod";
import path from "path";

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

  // Zoho Projects MCP (for CLI + MCP tool)
  ZOHO_PROJECTS_MCP_URL: z.string().url().optional().describe("Zoho Projects MCP server URL from mcp.zoho.com"),
  ZOHO_PROJECTS_PORTAL_ID: z.string().optional().describe("Zoho Projects Portal ID"),
  ZOHO_PROJECTS_PROJECT_ID: z.string().optional().describe("Zoho Projects Project ID"),

  // Zoho Bug Field Value IDs (unique per portal/project)
  ZOHO_BUG_STATUS_OPEN: z.string().optional().describe("Zoho bug status ID for 'Open'"),
  ZOHO_BUG_STATUS_FIXED: z.string().optional().describe("Zoho bug status ID for 'Fixed'"),
  ZOHO_BUG_SEVERITY_CRITICAL: z.string().optional().describe("Zoho bug severity ID for 'Critical'"),
  ZOHO_BUG_SEVERITY_MAJOR: z.string().optional().describe("Zoho bug severity ID for 'Major'"),
  ZOHO_BUG_SEVERITY_MINOR: z.string().optional().describe("Zoho bug severity ID for 'Minor'"),
});

export type CrashPointConfig = z.infer<typeof envSchema>;

let cachedConfig: CrashPointConfig | undefined;

export function getConfig(): CrashPointConfig {
  if (!cachedConfig) {
    cachedConfig = envSchema.parse(process.env);
  }
  return cachedConfig;
}

export function getBasicCrashesDir(config: CrashPointConfig): string {
  return path.join(config.CRASH_ANALYSIS_PARENT, "BasicCrashLogsFolder");
}

export function getSymbolicatedDir(config: CrashPointConfig): string {
  return path.join(config.CRASH_ANALYSIS_PARENT, "SymbolicatedCrashLogsFolder");
}
