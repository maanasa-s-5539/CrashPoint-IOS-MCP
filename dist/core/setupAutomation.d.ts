export interface SetupAutomationOptions {
    force?: boolean;
    packageRoot: string;
    parentDir: string;
}
export interface SetupAutomationResult {
    automationDir: string;
    scaffolded: string[];
    skipped: string[];
    force: boolean;
}
export declare function setupAutomationFiles({ force, packageRoot, parentDir, }: SetupAutomationOptions): SetupAutomationResult;
//# sourceMappingURL=setupAutomation.d.ts.map