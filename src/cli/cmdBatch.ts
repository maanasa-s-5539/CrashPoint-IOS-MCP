import { getConfig, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, hasCrashFiles } from "../config.js";
import { runBatch, BatchResult } from "../core/symbolicator.js";
import { ProcessedManifest } from "../processedManifest.js";

export async function cmdBatch(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const crashDir = getXcodeCrashesDir(config);
  const appticsDir = getAppticsCrashesDir(config);
  const otherDir = getOtherCrashesDir(config);
  const outputDir = getSymbolicatedDir(config);
  const dsymPath = config.DSYM_PATH;
  const includeProcessed = flags["include-processed"] === true;
  const manifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);

  if (!dsymPath) {
    console.error("Error: DSYM_PATH env var is required for batch symbolication.");
    process.exit(1);
  }

  if (!hasCrashFiles(crashDir) && !hasCrashFiles(appticsDir) && !hasCrashFiles(otherDir)) {
    console.log(
      JSON.stringify({
        succeeded: 0,
        failed: 0,
        total: 0,
        results: [],
        message: "No .crash or .ips files found in MainCrashLogsFolder/XCodeCrashLogs, MainCrashLogsFolder/AppticsCrashLogs, or MainCrashLogsFolder/OtherCrashLogs",
      }, null, 2)
    );
    return;
  }

  let succeeded = 0;
  let failed = 0;
  let total = 0;
  const results: BatchResult[] = [];

  for (const dir of [crashDir, appticsDir, otherDir]) {
    const r = await runBatch(dir, dsymPath, outputDir, manifest);
    succeeded += r.succeeded;
    failed += r.failed;
    total += r.total;
    results.push(...r.results);
  }

  console.log(JSON.stringify({ succeeded, failed, total, results }, null, 2));
}
