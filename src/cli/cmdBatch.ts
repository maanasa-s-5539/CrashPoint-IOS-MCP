import path from "path";
import { getConfig, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, hasCrashFiles } from "../config.js";
import { symbolicateOne, runBatch, BatchResult } from "../core/symbolicator.js";
import { assertNoTraversal } from "../pathSafety.js";
import { ProcessedManifest } from "../processedManifest.js";

export async function cmdBatch(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const outputDir = getSymbolicatedDir(config);
  const dsymPath = config.DSYM_PATH;
  const includeProcessed = flags["include-processed"] === true;
  const manifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);
  const filePath = flags["file"] as string | undefined;

  if (!dsymPath) {
    console.error("Error: DSYM_PATH env var is required for batch symbolication.");
    process.exit(1);
  }

  // Single-file mode
  if (filePath) {
    assertNoTraversal(filePath);
    const outputPath = path.join(outputDir, path.basename(filePath));
    const result = await symbolicateOne(filePath, dsymPath, outputPath);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const crashDir = getXcodeCrashesDir(config);
  const appticsDir = getAppticsCrashesDir(config);
  const otherDir = getOtherCrashesDir(config);

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

