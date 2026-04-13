export type { CrashPointConfig } from "./config.js";
export { getConfig, getMainCrashLogsDir, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, getAnalyzedReportsDir, getStateMaintenanceDir, getAutomationDir, getLatestJsonReportPath, getLatestCsvReportPath, hasCrashFiles } from "./config.js";
export type { CrashGroup, CrashReport, CrashMetadata, CrashedThread, CleanFileEntry, CleanResult } from "./core/crashAnalyzer.js";
export { analyzeDirectory, cleanOldCrashes, filterUnfixedGroups, parseCrashMetadata, buildSignature, analyzeCrashFile, detectSource } from "./core/crashAnalyzer.js";
export { exportCrashLogs } from "./core/crashExporter.js";
export type { BatchResult } from "./core/symbolicator.js";
export { symbolicateOne, runBatch, runBatchAll } from "./core/symbolicator.js";
export type { CsvExportResult } from "./core/csvExporter.js";
export { exportReportToCsv, reportToCsvString } from "./core/csvExporter.js";
export type { SetupOptions, SetupResult } from "./core/setup.js";
export { setupWorkspace } from "./core/setup.js";
export type { FixStatus, FixStatusStore, FixStatusEntry } from "./state/fixTracker.js";
export { FixTracker, loadFixStatuses } from "./state/fixTracker.js";
export { assertPathUnderBase, assertWritePathUnderBase, assertNoTraversal, assertSafeSymlinkTarget } from "./pathSafety.js";
export { ProcessedManifest, extractIncidentId } from "./state/processedManifest.js";
//# sourceMappingURL=index.d.ts.map