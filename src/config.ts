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
  DSYM_PATH: z.string().optional().describe("Path to MyApp.dSYM"),
  APP_PATH: z.string().optional().describe("Path to MyApp.app"),
  APP_NAME: z.string().optional().describe("App binary name e.g. MyApp"),
  CRASH_INPUT_DIR: z.string().optional().describe("Override .xccrashpoint search dir"),
  CRASH_VERSIONS: z.string().optional().describe("Comma-separated version filter"),
  MASTER_BRANCH_PATH: z.string().optional().describe("Path to current master/live branch checkout"),
  DEV_BRANCH_PATH: z.string().optional().describe("Path to current development branch checkout"),
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
