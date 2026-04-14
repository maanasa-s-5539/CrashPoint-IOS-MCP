export interface CleanupAllResult {
    dryRun: boolean;
    deleted: {
        xcodeCrashLogs: number;
        appticsCrashLogs: number;
        otherCrashLogs: number;
        symbolicatedCrashLogs: number;
        analyzedReports: number;
        stateManifests: number;
    };
    totalDeleted: number;
    files: string[];
}
export declare function cleanupAll(options?: {
    dryRun?: boolean;
    keepReports?: boolean;
    keepManifests?: boolean;
}): CleanupAllResult;
//# sourceMappingURL=cleanup.d.ts.map