import { ProcessedManifest } from "../state/processedManifest.js";
export interface CrashedThread {
    id: number;
    name: string;
    display: string;
}
export interface CrashGroup {
    rank: number;
    count: number;
    exception_type: string;
    exception_codes: string;
    crashed_thread: CrashedThread;
    top_frames: string[];
    devices: Record<string, number>;
    ios_versions: Record<string, number>;
    app_versions: Record<string, number>;
    sources: Record<string, number>;
    affected_files: string[];
    signature: string;
    fix_status?: {
        fixed: boolean;
        note?: string;
        date?: string;
    };
}
export interface CrashReport {
    report_date: string;
    source_dir: string;
    total_crashes: number;
    unique_crash_types: number;
    crash_groups: CrashGroup[];
    report_type?: string;
}
export interface CrashMetadata {
    exceptionType: string;
    exceptionCodes: string;
    hardwareModel: string;
    osVersion: string;
    appVersion: string;
    crashedThread: CrashedThread;
    topFrames: string[];
}
export declare function parseCrashMetadata(lines: string[]): CrashMetadata;
export declare function buildSignature(exceptionType: string, topFrames: string[]): string;
export declare function analyzeCrashFile(filepath: string): (CrashMetadata & {
    source: string;
}) | null;
export declare function detectSource(filepath: string): string;
export declare function analyzeDirectory(crashDir: string, fixStatuses?: Record<string, {
    fixed: boolean;
    note?: string;
}>, manifest?: ProcessedManifest): CrashReport;
/**
 * Analyze a specific list of crash file paths (instead of scanning a
 * directory).  Used by the scoped pipeline flow when only the files that were
 * just symbolicated need to be analyzed.
 */
export declare function analyzeFiles(files: string[], fixStatuses?: Record<string, {
    fixed: boolean;
    note?: string;
}>, manifest?: ProcessedManifest): CrashReport;
export interface CleanFileEntry {
    file: string;
    crashDate: string;
    deleted: boolean;
}
export interface CleanResult {
    deleted: number;
    skipped: number;
    totalScanned: number;
    files: CleanFileEntry[];
}
export declare function cleanOldCrashes(beforeDate: string, dirs: string[], dryRun?: boolean, parentDir?: string, manifest?: ProcessedManifest): CleanResult;
export declare function filterUnfixedGroups(report: CrashReport): {
    filtered: CrashReport;
    totalFixed: number;
    totalUnfixed: number;
};
//# sourceMappingURL=crashAnalyzer.d.ts.map