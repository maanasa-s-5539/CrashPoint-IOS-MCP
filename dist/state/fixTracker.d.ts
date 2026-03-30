export interface FixStatus {
    fixed: boolean;
    note?: string;
    updatedAt: string;
}
export type FixStatusStore = Record<string, FixStatus>;
export interface FixStatusEntry {
    signature: string;
    fixed: boolean;
    note?: string;
    updatedAt: string;
}
export declare class FixTracker {
    private filePath;
    constructor(parentDir: string);
    private load;
    private save;
    setFixed(signature: string, fixed: boolean, note?: string): FixStatus;
    getStatus(signature: string): FixStatus | undefined;
    getAll(): FixStatusEntry[];
    remove(signature: string): boolean;
}
export declare function loadFixStatuses(parentDir: string): Record<string, {
    fixed: boolean;
    note?: string;
}>;
//# sourceMappingURL=fixTracker.d.ts.map