import fs from "fs";
import path from "path";
import { getConfig, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, getAnalyzedReportsDir, hasCrashFiles } from "../config.js";
import { exportCrashLogs } from "../core/crashExporter.js";
import { runBatchAll, symbolicateFiles } from "../core/symbolicator.js";
import { analyzeDirectory, analyzeFiles } from "../core/crashAnalyzer.js";
import { loadFixStatuses } from "../state/fixTracker.js";
import { ProcessedManifest, extractIncidentId } from "../state/processedManifest.js";
import { exportReportToCsv } from "../core/csvExporter.js";
import { validateDateInput } from "../dateValidation.js";

export async function cmdPipeline(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const basicDir = getXcodeCrashesDir(config);
  const symbolicatedDir = getSymbolicatedDir(config);
  const dsymPath = config.DSYM_PATH;
  const includeProcessed = flags["include-processed"] === true;
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

  const hasDateRange = startDate !== undefined && endDate !== undefined;

  if (hasDateRange) {
    const rangeKey = `${startDate}..${endDate}`;

    // ── Fast-path: skip entire pipeline if range is already covered ──────
    if (!includeProcessed) {
      const fastPathManifest = new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
      if (fastPathManifest.isRangeCovered(startDate, endDate)) {
        console.log(`\nPipeline skipped: Range ${rangeKey} already fully processed.`);
        return;
      }
    }

    // ── Step 1: Export (date-filtered + per-crash dedup) ─────────────────
    const exportManifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
    const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false, startDate, endDate, exportManifest);
    console.log("\n── Export ──────────────────────────────────────────");
    console.log(JSON.stringify(exportResult, null, 2));

    // Collect only the files that were freshly exported in this run
    const exportedPaths = exportResult.files
      .filter((f) => !f.skipped)
      .map((f) => f.destination);

    // ── Step 2: Symbolicate ONLY the freshly exported files ──────────────
    let symbolicationResult: unknown = null;
    let symbolicatedPaths: string[] = [];

    console.log("\n── Symbolication ───────────────────────────────────");
    if (dsymPath) {
      if (exportedPaths.length === 0) {
        symbolicationResult = { skipped: true, reason: "No new files were exported for this date range" };
      } else {
        const symbolicateManifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "symbolicate");
        const batchRes = await symbolicateFiles(exportedPaths, dsymPath, symbolicatedDir, symbolicateManifest);
        symbolicationResult = batchRes;
        symbolicatedPaths = batchRes.results
          .filter((r) => r.success)
          .map((r) => path.join(symbolicatedDir, r.file));
      }
      console.log(JSON.stringify(symbolicationResult, null, 2));
    } else {
      symbolicationResult = { skipped: true, reason: "DSYM_PATH not set" };
      console.log(JSON.stringify(symbolicationResult, null, 2));
    }

    // ── Step 3: Analyze ONLY the freshly symbolicated files ──────────────
    const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
    const analyzeManifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "analyze");
    const report = analyzeFiles(symbolicatedPaths, fixStatuses, analyzeManifest);
    const reportsDir = getAnalyzedReportsDir(config);
    fs.mkdirSync(reportsDir, { recursive: true });
    const ts = Date.now();
    const reportFile = path.join(reportsDir, `jsonReport_${ts}.json`);
    const csvFile = path.join(reportsDir, `sheetReport_${ts}.csv`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf-8");
    exportReportToCsv(report, csvFile);
    const latestJsonPath = path.join(reportsDir, "latest.json");
    const latestCsvPath = path.join(reportsDir, "latest.csv");
    fs.copyFileSync(reportFile, latestJsonPath);
    fs.copyFileSync(csvFile, latestCsvPath);
    console.log("\n── Analysis ────────────────────────────────────────");
    console.log(JSON.stringify(report, null, 2));
    console.log(`JSON report saved to: ${reportFile}`);
    console.log(`CSV report saved to: ${csvFile}`);

    // ── Record completed pipeline run ─────────────────────────────────────
    const pipelineManifest = new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
    const resolvedCrashIds = exportedPaths.map((p) => extractIncidentId(p) ?? path.basename(p));
    pipelineManifest.recordPipelineRun(rangeKey, {
      startDate,
      endDate,
      completedAt: new Date().toISOString(),
      crashIds: resolvedCrashIds,
      exportedCount: exportedPaths.length,
      symbolicatedCount: symbolicatedPaths.length,
      analyzedCount: report.total_crashes,
      reportPath: reportFile,
    });
    return;
  }

  // ── No date range: existing unscoped flow ────────────────────────────────
  const exportManifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
  const symbolicateManifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "symbolicate");
  const analyzeManifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "analyze");

  // Step 1: export
  const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false, undefined, undefined, exportManifest);
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
      symbolicationResult = await runBatchAll(dsymPath, symbolicateManifest);
    }
    console.log("\n── Symbolication ───────────────────────────────────");
    console.log(JSON.stringify(symbolicationResult, null, 2));
  } else {
    console.log("\n── Symbolication ───────────────────────────────────");
    console.log(JSON.stringify({ skipped: true, reason: "DSYM_PATH not set" }, null, 2));
  }

  // Step 3: analyze
  const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
  const report = analyzeDirectory(symbolicatedDir, fixStatuses, analyzeManifest);
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
