import fs from "fs";
import path from "path";
import { getConfig, getSymbolicatedDir } from "../config.js";
import { analyzeDirectory, filterUnfixedGroups } from "../core/crashAnalyzer.js";
import { loadFixStatuses } from "../fixTracker.js";
import { sendCrashReportToCliq } from "../integrations/cliqNotifier.js";
import { assertPathUnderBase } from "../pathSafety.js";

export async function cmdNotify(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const crashDir = (flags["crash-dir"] as string) ?? getSymbolicatedDir(config);
  const unfixedOnly = flags["unfixed-only"] === true;
  const dryRun = flags["dry-run"] === true;
  const outputFile = (flags["o"] as string) ?? undefined;

  if (outputFile) {
    assertPathUnderBase(outputFile, config.CRASH_ANALYSIS_PARENT);
  }

  const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
  const fullReport = analyzeDirectory(crashDir, fixStatuses);

  let reportToSend = fullReport;

  if (unfixedOnly) {
    const { filtered, totalFixed, totalUnfixed } = filterUnfixedGroups(fullReport);
    reportToSend = filtered;
    console.log(`Unfixed: ${totalUnfixed} type(s), Fixed: ${totalFixed} type(s)`);
  }

  if (dryRun) {
    if (outputFile) {
      fs.writeFileSync(outputFile, JSON.stringify(reportToSend, null, 2), "utf-8");
      console.log(`Report written to ${path.resolve(outputFile)}`);
    } else {
      console.log(JSON.stringify(reportToSend, null, 2));
    }
    console.log("Dry-run: no notification sent to Cliq.");
    return;
  }

  if (reportToSend.unique_crash_types === 0) {
    console.log(unfixedOnly ? "No unfixed crashes to report. Skipping Cliq notification." : "No crashes to report. Skipping Cliq notification.");
    return;
  }

  const result = await sendCrashReportToCliq(reportToSend, config);
  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify(reportToSend, null, 2), "utf-8");
    console.log(`Report written to ${path.resolve(outputFile)}`);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) {
    process.exit(1);
  }
}
