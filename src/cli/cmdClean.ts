import { getConfig, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir } from "../config.js";
import { cleanOldCrashes } from "../core/crashAnalyzer.js";
import { ProcessedManifest } from "../state/processedManifest.js";
import { validateDateInput } from "../dateValidation.js";

export function cmdClean(flags: Record<string, string | boolean>): void {
  const beforeDate = flags["before-date"] as string;
  if (!beforeDate) {
    console.error("Error: --before-date <ISO date> is required for clean command.");
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

  const dirs = [
    getXcodeCrashesDir(config),
    getAppticsCrashesDir(config),
    getOtherCrashesDir(config),
    getSymbolicatedDir(config),
  ];

  const manifest = dryRun ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);
  const result = cleanOldCrashes(beforeDate, dirs, dryRun, config.CRASH_ANALYSIS_PARENT, manifest);
  console.log(JSON.stringify(result, null, 2));
  if (dryRun) {
    console.log(`Dry-run: ${result.deleted} file(s) would be deleted, ${result.skipped} skipped.`);
  } else {
    console.log(`Deleted ${result.deleted} file(s), skipped ${result.skipped}.`);
  }
}
