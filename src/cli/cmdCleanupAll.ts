import {
  getConfig,
  getXcodeCrashesDir,
  getAppticsCrashesDir,
  getOtherCrashesDir,
  getSymbolicatedDir,
  getAnalyzedReportsDir,
  getStateMaintenanceDir,
  cleanFilesFromDir,
} from "../config.js";

export function cmdCleanupAll(flags: Record<string, string | boolean>): void {
  const dryRun = Boolean(flags["dry-run"]);
  const keepReports = Boolean(flags["keep-reports"]);
  const keepManifests = Boolean(flags["keep-manifests"]);

  const config = getConfig();

  const counts = {
    xcodeCrashLogs: 0,
    appticsCrashLogs: 0,
    otherCrashLogs: 0,
    symbolicatedCrashLogs: 0,
    analyzedReports: 0,
    stateManifests: 0,
  };
  const deletedFiles: string[] = [];

  function accumulate(files: string[], countKey: keyof typeof counts): void {
    deletedFiles.push(...files);
    counts[countKey] += files.length;
  }

  accumulate(cleanFilesFromDir(getXcodeCrashesDir(config), [".crash", ".ips"], dryRun), "xcodeCrashLogs");
  accumulate(cleanFilesFromDir(getAppticsCrashesDir(config), [".crash", ".ips"], dryRun), "appticsCrashLogs");
  accumulate(cleanFilesFromDir(getOtherCrashesDir(config), [".crash", ".ips"], dryRun), "otherCrashLogs");
  accumulate(cleanFilesFromDir(getSymbolicatedDir(config), [".crash", ".ips"], dryRun), "symbolicatedCrashLogs");

  if (!keepReports) {
    accumulate(cleanFilesFromDir(getAnalyzedReportsDir(config), [".json", ".csv"], dryRun), "analyzedReports");
  }

  if (!keepManifests) {
    accumulate(cleanFilesFromDir(getStateMaintenanceDir(config), [".json"], dryRun), "stateManifests");
  }

  const totalDeleted = Object.values(counts).reduce((s, n) => s + n, 0);
  const result = { dryRun, deleted: counts, totalDeleted, files: deletedFiles };
  console.log(JSON.stringify(result, null, 2));
}
