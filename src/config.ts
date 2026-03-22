import dotenv from "dotenv";
import { z } from "zod";
import path from "path";

dotenv.config({ quiet: true });

const envSchema = z.object({
  CRASH_ANALYSIS_PARENT: z.string().min(1).describe("Path to ParentHolderFolder"),
  DSYM_PATH: z.string().optional().describe("Path to MyApp.dSYM"),
  APP_PATH: z.string().optional().describe("Path to MyApp.app"),
  APP_NAME: z.string().optional().describe("App binary name e.g. MyApp"),
  CRASH_INPUT_DIR: z.string().optional().describe("Override .xccrashpoint search dir"),
  CRASH_VERSIONS: z.string().optional().describe("Comma-separated version filter"),
  ZOHO_CLIQ_WEBHOOK_URL: z.string().optional().describe("Cliq channel webhook URL"),
  ZOHO_CLIQ_BOT_WEBHOOK_URL: z.string().optional().describe("Cliq bot webhook URL"),
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
