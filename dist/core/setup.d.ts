export interface SetupOptions {
    masterBranchPath?: string;
    devBranchPath?: string;
    dsymPath?: string;
    appPath?: string;
}
export interface SetupResult {
    parentDir: string;
    created: string[];
    symlinks: Array<{
        link: string;
        target: string;
        status: string;
    }>;
    warnings: string[];
}
export declare function setupWorkspace(options?: SetupOptions): SetupResult;
//# sourceMappingURL=setup.d.ts.map