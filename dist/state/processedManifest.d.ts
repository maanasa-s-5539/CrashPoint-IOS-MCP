/**
 * Read the first ~4 KB of a crash file and return the Incident Identifier
 * UUID, or null if not found (e.g. non-standard / .ips format without it).
 */
export declare function extractIncidentId(filePath: string): string | null;
export declare class ProcessedManifest {
    private manifestPath;
    private data;
    constructor(parentDir: string);
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
}
//# sourceMappingURL=processedManifest.d.ts.map