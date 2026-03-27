import { getConfig } from "../config.js";
import { listAvailableVersions } from "../core/crashExporter.js";

export function cmdListVersions(flags: Record<string, string | boolean>): void {
  const config = getConfig();
  const inputDir = (flags["input-dir"] as string) ?? config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const recursive = flags["recursive"] === true;
  const versions = listAvailableVersions(inputDir, recursive);
  console.log(JSON.stringify(versions, null, 2));
}
