import { z } from "zod";
declare const envSchema: z.ZodObject<{
    CRASH_ANALYSIS_PARENT: z.ZodString;
    DSYM_PATH: z.ZodOptional<z.ZodString>;
    APP_PATH: z.ZodOptional<z.ZodString>;
    APP_NAME: z.ZodOptional<z.ZodString>;
    CRASH_INPUT_DIR: z.ZodOptional<z.ZodString>;
    CRASH_VERSIONS: z.ZodOptional<z.ZodString>;
    MASTER_BRANCH_PATH: z.ZodOptional<z.ZodString>;
    DEV_BRANCH_PATH: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CrashPointConfig = z.infer<typeof envSchema>;
export declare function getConfig(): CrashPointConfig;
export declare function getMainCrashLogsDir(config: CrashPointConfig): string;
export declare function getXcodeCrashesDir(config: CrashPointConfig): string;
export declare function getAppticsCrashesDir(config: CrashPointConfig): string;
export declare function getOtherCrashesDir(config: CrashPointConfig): string;
export declare function getSymbolicatedDir(config: CrashPointConfig): string;
export declare function getAnalyzedReportsDir(config: CrashPointConfig): string;
export declare function getStateMaintenanceDir(config: CrashPointConfig): string;
export declare function getAutomationDir(config: CrashPointConfig): string;
export declare function hasCrashFiles(dir: string): boolean;
export {};
//# sourceMappingURL=config.d.ts.map