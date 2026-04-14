import fs from "fs";
import path from "path";
import {
  getConfig,
  getXcodeCrashesDir,
  getAppticsCrashesDir,
  getOtherCrashesDir,
  getSymbolicatedDir,
  getAnalyzedReportsDir,
  getStateMaintenanceDir,
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

  function cleanDir(dir: string, extensions: string[], countKey: keyof typeof counts): void {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter((f) => extensions.some((ext) => f.endsWith(ext)));
    for (const f of files) {
      const fullPath = path.join(dir, f);
      deletedFiles.push(fullPath);
      counts[countKey]++;
      if (!dryRun) fs.unlinkSync(fullPath);
    }
  }

  cleanDir(getXcodeCrashesDir(config), [".crash", ".ips"], "xcodeCrashLogs");
  cleanDir(getAppticsCrashesDir(config), [".crash", ".ips"], "appticsCrashLogs");
  cleanDir(getOtherCrashesDir(config), [".crash", ".ips"], "otherCrashLogs");
  cleanDir(getSymbolicatedDir(config), [".crash", ".ips"], "symbolicatedCrashLogs");

  if (!keepReports) {
    const reportsDir = getAnalyzedReportsDir(config);
    if (fs.existsSync(reportsDir)) {
      const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith(".json") || f.endsWith(".csv"));
      for (const f of files) {
        const fullPath = path.join(reportsDir, f);
        deletedFiles.push(fullPath);
        counts.analyzedReports++;
        if (!dryRun) fs.unlinkSync(fullPath);
      }
    }
  }

  if (!keepManifests) {
    const stateDir = getStateMaintenanceDir(config);
    if (fs.existsSync(stateDir)) {
      const files = fs.readdirSync(stateDir).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        const fullPath = path.join(stateDir, f);
        deletedFiles.push(fullPath);
        counts.stateManifests++;
        if (!dryRun) fs.unlinkSync(fullPath);
      }
    }
  }

  const totalDeleted = Object.values(counts).reduce((s, n) => s + n, 0);
  const result = { dryRun, deleted: counts, totalDeleted, files: deletedFiles };
  console.log(JSON.stringify(result, null, 2));
}
