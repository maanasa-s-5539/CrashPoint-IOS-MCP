import fs from "fs";
import path from "path";
import { getConfig, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, hasCrashFiles } from "../config.js";
import { exportCrashLogs } from "../core/crashExporter.js";
import { runBatchAll } from "../core/symbolicator.js";
import { analyzeDirectory } from "../core/crashAnalyzer.js";
import { loadFixStatuses } from "../state/fixTracker.js";
import { ProcessedManifest } from "../state/processedManifest.js";

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

  // Step 1: export
  const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false, startDate, endDate, manifest);
  console.log("Export:", JSON.stringify(exportResult));

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
    console.log("Symbolication:", JSON.stringify(symbolicationResult));
  } else {
    console.log("Symbolication: skipped (DSYM_PATH not set)");
  }

  // Step 3: analyze
  const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
  const report = analyzeDirectory(symbolicatedDir, fixStatuses, manifest);
  const reportFile = path.join(config.CRASH_ANALYSIS_PARENT, `report_${Date.now()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf-8");
  console.log("Analysis:", JSON.stringify(report));
  console.log(`Report saved to: ${reportFile}`);
}
