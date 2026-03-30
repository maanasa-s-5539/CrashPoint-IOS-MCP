import { ProcessedManifest } from "../state/processedManifest.js";
export interface SymbolicateResult {
    success: boolean;
}
export interface BatchResult {
    file: string;
    success: boolean;
}
export declare function symbolicateOne(crashPath: string, dsymPath: string, outputPath: string): Promise<SymbolicateResult>;
export declare function runBatch(crashDir: string, dsymPath: string, outputDir: string, manifest?: ProcessedManifest): Promise<{
    succeeded: number;
    failed: number;
    total: number;
    results: BatchResult[];
}>;
export declare function runBatchAll(dsymPath: string, manifest?: ProcessedManifest): Promise<{
    succeeded: number;
    failed: number;
    total: number;
    results: BatchResult[];
}>;
//# sourceMappingURL=symbolicator.d.ts.map