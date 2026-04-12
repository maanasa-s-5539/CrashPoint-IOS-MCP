import { getConfig, getXcodeCrashesDir } from "../config.js";
import { exportCrashLogs } from "../core/crashExporter.js";
import { ProcessedManifest } from "../state/processedManifest.js";
import { computeDateRange } from "../dateValidation.js";

export async function cmdExport(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const outputDir = getXcodeCrashesDir(config);
  const versions = config.CRASH_VERSIONS?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  const numDaysRaw = flags["num-days"] as string | undefined;
  const offset = parseInt(config.CRASH_DATE_OFFSET ?? "4", 10);
  const numDays = numDaysRaw ? parseInt(numDaysRaw, 10) : parseInt(config.CRASH_NUM_DAYS ?? "1", 10);
  const { startDateISO, endDateISO } = computeDateRange(numDays, offset);
  const dryRun = flags["dry-run"] === true;
  const includeProcessed = flags["include-processed"] === true;
  const manifest = dryRun || includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
  const result = exportCrashLogs(inputDir, outputDir, versions, false, dryRun, startDateISO, endDateISO, manifest);
  console.log(JSON.stringify(result, null, 2));
}
