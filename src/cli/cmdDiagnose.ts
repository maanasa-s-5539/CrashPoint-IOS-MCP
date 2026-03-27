import { getConfig } from "../config.js";
import { diagnoseFrames } from "../core/symbolicator.js";

export function cmdDiagnose(flags: Record<string, string | boolean>): void {
  const crashPath = flags["crash"] as string;
  const symbolicatedPath = flags["symbolicated"] as string;
  if (!crashPath || !symbolicatedPath) {
    console.error("Error: --crash <path> and --symbolicated <path> are required for diagnose command.");
    process.exit(1);
  }
  const config = getConfig();
  const appName = (flags["app-name"] as string) ?? config.APP_NAME;

  const result = diagnoseFrames(crashPath, symbolicatedPath, appName);
  console.log(JSON.stringify(result, null, 2));
}
