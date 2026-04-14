export interface AppticsCrashEntry {
    UniqueMessageID: string;
    Exception: string;
    CrashCount: string;
    DevicesCount: string;
    UsersCount: string;
    AppVersion: string;
    OS: string;
    Status: number;
    PID: number;
    AppVersionID: number;
}
export interface AppticsCrashDetail {
    date?: string;
    Message?: string;
    OS?: string;
    Screen?: string;
    DeviceID?: string;
    NetworkStatus?: string;
    PID?: number;
    SessionStartTime?: string;
    AppVersionID?: number;
    Exception?: string;
    AppVersion?: string;
    BatteryStatus?: string;
    UserID?: string;
    JAnalyticVersion?: string;
    IssueName?: string;
    Model?: string;
    OSVersion?: string;
    UniqueMessageID?: string;
    Edge?: string;
    AppReleaseVersion?: string;
    HappenedAt?: string;
    CustomProperties?: string;
    [key: string]: unknown;
}
/** Convert ISO date (YYYY-MM-DD) to Apptics format (dd-MM-yyyy). */
export declare function isoToAppticsDate(isoDate: string): string;
/**
 * Format a crash detail into an Apple-style .crash file content.
 * Constructs a human-readable crash report from the Apptics API response.
 */
export declare function formatCrashFile(detail: AppticsCrashDetail, entry: AppticsCrashEntry): string;
//# sourceMappingURL=appticsFormatter.d.ts.map