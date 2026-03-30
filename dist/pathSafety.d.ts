import type { CrashPointConfig } from "./config.js";
export declare function assertPathUnderBase(userPath: string, base: string): string;
export declare function assertWritePathUnderBase(writePath: string, config: CrashPointConfig): string;
export declare function assertNoTraversal(userPath: string): string;
export declare function assertSafeSymlinkTarget(target: string): void;
//# sourceMappingURL=pathSafety.d.ts.map