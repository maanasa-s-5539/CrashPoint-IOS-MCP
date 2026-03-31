import { z } from "zod";
declare const envSchema: any;
export type CrashPointConfig = z.infer<typeof envSchema>;
export declare function getConfig(): CrashPointConfig;
export declare function getMainCrashLogsDir(config: CrashPointConfig): string;
export declare function getXcodeCrashesDir(config: CrashPointConfig): string;
export declare function getAppticsCrashesDir(config: CrashPointConfig): string;
export declare function getOtherCrashesDir(config: CrashPointConfig): string;
export declare function getSymbolicatedDir(config: CrashPointConfig): string;
export declare function getAnalyzedReportsDir(config: CrashPointConfig): string;
export declare function getStateMaintenanceDir(config: CrashPointConfig): string;
export declare function hasCrashFiles(dir: string): boolean;
export {};
//# sourceMappingURL=config.d.ts.map