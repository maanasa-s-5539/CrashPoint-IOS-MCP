// Barrel re-exports for package consumers
export type { CrashPointConfig } from "./config.js";
export { getConfig, getMainCrashLogsDir, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, getAnalyzedReportsDir, getStateMaintenanceDir, getAutomationDir, getLatestJsonReportPath, getLatestCsvReportPath, hasCrashFiles, getSeverityId, cleanFilesFromDir } from "./config.js";

export type { CrashGroup, CrashReport, CrashMetadata, CrashedThread, CleanFileEntry, CleanResult } from "./core/crashAnalyzer.js";
export { analyzeDirectory, cleanOldCrashes, filterUnfixedGroups, parseCrashMetadata, buildSignature, analyzeCrashFile, detectSource } from "./core/crashAnalyzer.js";

export { exportCrashLogs } from "./core/crashExporter.js";

export type { BatchResult } from "./core/symbolicator.js";
export { symbolicateOne, runBatch, runBatchAll } from "./core/symbolicator.js";

export type { CsvExportResult } from "./core/csvExporter.js";
export { exportReportToCsv, reportToCsvString } from "./core/csvExporter.js";

export type { SetupOptions, SetupResult } from "./core/setup.js";
export { setupWorkspace } from "./core/setup.js";

export type { SetupAutomationOptions, SetupAutomationResult } from "./core/setupAutomation.js";
export { setupAutomationFiles } from "./core/setupAutomation.js";

export type { AppticsCrashEntry, AppticsCrashDetail } from "./core/appticsFormatter.js";
export { isoToAppticsDate, formatCrashFile } from "./core/appticsFormatter.js";

export type { FullCrashPointConfig } from "./core/automationTemplates.js";
export { generateMcpJson, generatePlist } from "./core/automationTemplates.js";

export type { FixStatus, FixStatusStore, FixStatusEntry } from "./state/fixTracker.js";
export { FixTracker, loadFixStatuses } from "./state/fixTracker.js";

export { assertPathUnderBase, assertWritePathUnderBase, assertNoTraversal, assertSafeSymlinkTarget } from "./pathSafety.js";

export { ProcessedManifest, extractIncidentId } from "./state/processedManifest.js";
