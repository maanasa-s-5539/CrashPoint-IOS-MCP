import fs from "fs";
import path from "path";
import { getConfig, getSymbolicatedDir } from "../config.js";
import { analyzeDirectory } from "../core/crashAnalyzer.js";
import { exportReportToCsv } from "../core/csvExporter.js";
import { loadFixStatuses } from "../fixTracker.js";
import { assertPathUnderBase } from "../pathSafety.js";
import { ProcessedManifest } from "../processedManifest.js";

export async function cmdAnalyze(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const crashDir = (flags["crash-dir"] as string) ?? getSymbolicatedDir(config);
  const outputFile = (flags["o"] as string) ?? undefined;
  const csvPath = (flags["csv"] as string) ?? undefined;
  const includeProcessed = flags["include-processed"] === true;
  const manifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);

  if (outputFile) {
    assertPathUnderBase(outputFile, config.CRASH_ANALYSIS_PARENT);
  }
  if (csvPath) {
    assertPathUnderBase(csvPath, config.CRASH_ANALYSIS_PARENT);
  }

  const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
  const report = analyzeDirectory(crashDir, fixStatuses, manifest);

  const json = JSON.stringify(report, null, 2);
  if (outputFile) {
    fs.writeFileSync(outputFile, json, "utf-8");
    console.log(`Report written to ${path.resolve(outputFile)}`);
  } else {
    console.log(json);
  }

  if (csvPath) {
    const csvResult = exportReportToCsv(report, csvPath);
    if (csvResult.success) {
      console.log(`CSV exported to ${path.resolve(csvPath)} (${csvResult.totalRows} row(s))`);
    } else {
      console.error(`CSV export failed: ${csvResult.message}`);
    }
  }
}

