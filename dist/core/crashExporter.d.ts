import { ProcessedManifest } from "../state/processedManifest.js";
export interface ExportEntry {
    source: string;
    destination: string;
    version: string;
    skipped: boolean;
    reason?: string;
}
export interface ExportResult {
    canBeExported?: number;
    exported: number;
    skipped: number;
    errors: string[];
    files: ExportEntry[];
}
export declare function extractCrashDate(crashFilePath: string): Date | null;
export declare function extractVersion(crashFilePath: string): string;
export declare function detectCrashSource(filepath: string): string;
export declare function findCrashLogs(xccrashpointPath: string): string[];
export declare function exportCrashLogs(inputDir: string, outputDir: string, versions?: string[], recursive?: boolean, dryRun?: boolean, startDate?: string, endDate?: string, manifest?: ProcessedManifest): ExportResult;
//# sourceMappingURL=crashExporter.d.ts.map