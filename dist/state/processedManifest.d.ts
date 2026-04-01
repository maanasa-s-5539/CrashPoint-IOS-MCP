/**
 * Read the first ~4 KB of a crash file and return the Incident Identifier
 * UUID, or null if not found (e.g. non-standard / .ips format without it).
 */
export declare function extractIncidentId(filePath: string): string | null;
export type ManifestStage = "export" | "symbolicate" | "analyze";
export interface PipelineRun {
    startDate: string;
    endDate: string;
    completedAt: string;
    crashIds: string[];
    exportedCount: number;
    symbolicatedCount: number;
    analyzedCount: number;
    reportPath?: string;
}
export declare class ProcessedManifest {
    private manifestPath;
    private data;
    private stage;
    constructor(parentDir: string, stage: ManifestStage);
    private sectionKey;
    private load;
    private save;
    isProcessed(crashId: string): boolean;
    markProcessed(crashId: string): void;
    getAll(): Record<string, {
        processedAt: string;
    }>;
    removeProcessed(crashId: string): void;
    removeProcessedBatch(crashIds: string[]): void;
    clear(): void;
    isPipelineRunComplete(rangeKey: string): boolean;
    /**
     * Check whether the union of all existing pipeline_runs fully covers the
     * requested [startDate, endDate] range (inclusive).  Uses date comparison,
     * not string comparison.
     */
    isRangeCovered(startDate: string, endDate: string): boolean;
    recordPipelineRun(rangeKey: string, run: PipelineRun): void;
    getPipelineRun(rangeKey: string): PipelineRun | undefined;
}
//# sourceMappingURL=processedManifest.d.ts.map