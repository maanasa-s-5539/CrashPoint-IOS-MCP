// Barrel re-exports for package consumers
export type { CrashPointConfig } from "./config.js";
export { getConfig, getMainCrashLogsDir, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, hasCrashFiles } from "./config.js";

export type { CrashGroup, CrashReport, CrashMetadata, CrashedThread, CleanFileEntry, CleanResult } from "./core/crashAnalyzer.js";
export { analyzeDirectory, cleanOldCrashes, filterUnfixedGroups, parseCrashMetadata, buildSignature, analyzeCrashFile, detectSource } from "./core/crashAnalyzer.js";

export { exportCrashLogs, listAvailableVersions } from "./core/crashExporter.js";

export type { BatchResult } from "./core/symbolicator.js";
export { symbolicateOne, runBatch } from "./core/symbolicator.js";

export type { CsvExportResult } from "./core/csvExporter.js";
export { exportReportToCsv, reportToCsvString } from "./core/csvExporter.js";

export type { SetupOptions, SetupResult } from "./core/setup.js";
export { setupWorkspace } from "./core/setup.js";

export type { FixStatus, FixStatusStore, FixStatusEntry } from "./fixTracker.js";
export { FixTracker, loadFixStatuses } from "./fixTracker.js";

export { assertPathUnderBase, assertNoTraversal, assertSafeSymlinkTarget } from "./pathSafety.js";

export { ProcessedManifest, extractIncidentId } from "./processedManifest.js";
