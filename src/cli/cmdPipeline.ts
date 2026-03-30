import fs from "fs";
import path from "path";
import { getConfig, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, getAnalyzedReportsDir, hasCrashFiles } from "../config.js";
import { exportCrashLogs } from "../core/crashExporter.js";
import { runBatchAll } from "../core/symbolicator.js";
import { analyzeDirectory } from "../core/crashAnalyzer.js";
import { loadFixStatuses } from "../state/fixTracker.js";
import { ProcessedManifest } from "../state/processedManifest.js";
import { exportReportToCsv } from "../core/csvExporter.js";
import { validateDateInput } from "../dateValidation.js";

export async function cmdPipeline(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const basicDir = getXcodeCrashesDir(config);
  const symbolicatedDir = getSymbolicatedDir(config);
  const dsymPath = config.DSYM_PATH;
  const includeProcessed = flags["include-processed"] === true;
  const manifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);
  const versions = flags["versions"]
    ? (flags["versions"] as string).split(",").map((v) => v.trim()).filter(Boolean)
    : (config.CRASH_VERSIONS?.split(",").map((v) => v.trim()).filter(Boolean) ?? []);
  const startDate = flags["start-date"] as string | undefined;
  const endDate = flags["end-date"] as string | undefined;

  if (startDate !== undefined) {
    try {
      validateDateInput(startDate, "--start-date");
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  if (endDate !== undefined) {
    try {
      validateDateInput(endDate, "--end-date");
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // Step 1: export
  const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false, startDate, endDate, manifest);
  console.log("\n── Export ──────────────────────────────────────────");
  console.log(JSON.stringify(exportResult, null, 2));

  // Step 2: symbolicate
  let symbolicationResult: unknown = null;
  if (dsymPath) {
    const appticsDir = getAppticsCrashesDir(config);
    const otherDir = getOtherCrashesDir(config);

    if (!hasCrashFiles(basicDir) && !hasCrashFiles(appticsDir) && !hasCrashFiles(otherDir)) {
      symbolicationResult = {
        skipped: true,
        reason: "No .crash or .ips files found in MainCrashLogsFolder/XCodeCrashLogs, MainCrashLogsFolder/AppticsCrashLogs, or MainCrashLogsFolder/OtherCrashLogs",
      };
    } else {
      symbolicationResult = await runBatchAll(dsymPath, manifest);
    }
    console.log("\n── Symbolication ───────────────────────────────────");
    console.log(JSON.stringify(symbolicationResult, null, 2));
  } else {
    console.log("\n── Symbolication ───────────────────────────────────");
    console.log(JSON.stringify({ skipped: true, reason: "DSYM_PATH not set" }, null, 2));
  }

  // Step 3: analyze
  const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
  const report = analyzeDirectory(symbolicatedDir, fixStatuses, manifest);
  const reportsDir = getAnalyzedReportsDir(config);
  fs.mkdirSync(reportsDir, { recursive: true });
  const ts = Date.now();
  const reportFile = path.join(reportsDir, `jsonReport_${ts}.json`);
  const csvFile = path.join(reportsDir, `sheetReport_${ts}.csv`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf-8");
  exportReportToCsv(report, csvFile);
  console.log("\n── Analysis ────────────────────────────────────────");
  console.log(JSON.stringify(report, null, 2));
  console.log(`JSON report saved to: ${reportFile}`);
  console.log(`CSV report saved to: ${csvFile}`);
}
