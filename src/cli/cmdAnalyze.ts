import fs from "fs";
import path from "path";
import { getConfig, getSymbolicatedDir, getAnalyzedReportsDir } from "../config.js";
import { analyzeDirectory } from "../core/crashAnalyzer.js";
import { exportReportToCsv } from "../core/csvExporter.js";
import { loadFixStatuses } from "../state/fixTracker.js";
import { ProcessedManifest } from "../state/processedManifest.js";

export async function cmdAnalyze(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const crashDir = getSymbolicatedDir(config);
  const includeProcessed = flags["include-processed"] === true;
  const manifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);

  const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
  const report = analyzeDirectory(crashDir, fixStatuses, manifest);

  const json = JSON.stringify(report, null, 2);
  console.log(json);

  const reportsDir = getAnalyzedReportsDir(config);
  fs.mkdirSync(reportsDir, { recursive: true });
  const ts = Date.now();
  const jsonFile = path.join(reportsDir, `jsonReport_${ts}.json`);
  const csvFile = path.join(reportsDir, `sheetReport_${ts}.csv`);

  fs.writeFileSync(jsonFile, json, "utf-8");
  console.log(`JSON report written to ${jsonFile}`);

  const csvResult = exportReportToCsv(report, csvFile);
  if (csvResult.success) {
    console.log(`CSV report written to ${csvFile} (${csvResult.totalRows} row(s))`);
  } else {
    console.error(`CSV export failed: ${csvResult.message}`);
  }
}

