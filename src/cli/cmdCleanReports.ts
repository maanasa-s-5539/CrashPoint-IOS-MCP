import { getConfig, getAnalyzedReportsDir } from "../config.js";
import { cleanOldReports } from "../core/reportCleaner.js";
import { validateDateInput } from "../dateValidation.js";

export function cmdCleanReports(flags: Record<string, string | boolean>): void {
  const beforeDate = flags["before-date"] as string;
  if (!beforeDate) {
    console.error("Error: --before-date <ISO date> is required for cleanup-reports command.");
    process.exit(1);
  }
  try {
    validateDateInput(beforeDate, "--before-date");
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
  const dryRun = flags["dry-run"] === true;
  const config = getConfig();
  const reportsDir = getAnalyzedReportsDir(config);

  const result = cleanOldReports(beforeDate, reportsDir, dryRun);
  console.log(JSON.stringify(result, null, 2));
  if (dryRun) {
    console.log(`Dry-run: ${result.deleted} report file(s) would be deleted, ${result.skipped} skipped.`);
  } else {
    console.log(`Deleted ${result.deleted} report file(s), skipped ${result.skipped}.`);
  }
}
