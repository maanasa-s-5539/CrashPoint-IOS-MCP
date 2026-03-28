import { getConfig, getXcodeCrashesDir } from "../config.js";
import { exportCrashLogs } from "../core/crashExporter.js";
import { ProcessedManifest } from "../state/processedManifest.js";

export async function cmdExport(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const outputDir = getXcodeCrashesDir(config);
  const versions = config.CRASH_VERSIONS?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  const startDate = flags["start-date"] as string | undefined;
  const endDate = flags["end-date"] as string | undefined;
  const dryRun = flags["dry-run"] === true;
  const includeProcessed = flags["include-processed"] === true;
  const manifest = dryRun || includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);
  const result = exportCrashLogs(inputDir, outputDir, versions, false, dryRun, startDate, endDate, manifest);
  console.log(JSON.stringify(result, null, 2));
}
