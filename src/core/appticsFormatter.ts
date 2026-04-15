// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Date Formatting ─────────────────────────────────────────────────────────

/** Convert ISO date (YYYY-MM-DD) to Apptics format (dd-MM-yyyy). */
export function isoToAppticsDate(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split("-");
  return `${dd}-${mm}-${yyyy}`;
}

// ─── Crash File Formatting ───────────────────────────────────────────────────

/**
 * Format a crash detail into an Apple-style .crash file content.
 * Constructs a human-readable crash report from the Apptics API response.
 */
export function formatCrashFile(detail: AppticsCrashDetail, entry: AppticsCrashEntry): string {
  const lines: string[] = [];

  // Header
  lines.push(`Incident Identifier: ${detail.UniqueMessageID ?? entry.UniqueMessageID}`);
  lines.push(`CrashReporter Key:   ${detail.DeviceID ?? "unknown"}`);
  lines.push(`Hardware Model:      ${detail.Model ?? "unknown"}`);
  lines.push(`Process:             ${entry.Exception ?? detail.IssueName ?? "unknown"}`);
  lines.push(`Date/Time:           ${detail.date ?? detail.HappenedAt ?? "unknown"}`);
  lines.push(`OS Version:          ${detail.OS ?? entry.OS ?? "unknown"} ${detail.OSVersion ?? ""}`);
  lines.push(`App Version:         ${detail.AppVersion ?? entry.AppVersion ?? "unknown"} (${detail.AppReleaseVersion ?? ""})`);
  lines.push("");

  // Exception info
  lines.push(`Exception Type:  ${entry.Exception ?? detail.IssueName ?? "unknown"}`);
  if (detail.Message) {
    lines.push(`Exception Note:  ${detail.Message}`);
  }
  lines.push("");

  // Stack trace / exception details
  const trace = detail.Exception ?? "";
  if (trace) {
    lines.push("Thread 0 Crashed:");
    lines.push(trace);
    lines.push("");
  }

  // Additional metadata
  lines.push("--- Apptics Metadata ---");
  lines.push("Warning: This crash file contains only Apptics metadata — no full crash report was available.");
  lines.push(`Source:          Apptics`);
  lines.push(`UniqueMessageID: ${entry.UniqueMessageID}`);
  lines.push(`CrashCount:      ${entry.CrashCount}`);
  lines.push(`DevicesCount:    ${entry.DevicesCount}`);
  lines.push(`UsersCount:      ${entry.UsersCount}`);
  if (detail.NetworkStatus) lines.push(`NetworkStatus:   ${detail.NetworkStatus}`);
  if (detail.BatteryStatus) lines.push(`BatteryStatus:   ${detail.BatteryStatus}`);
  if (detail.Edge) lines.push(`Edge:            ${detail.Edge}`);
  if (detail.Screen) lines.push(`Screen:          ${detail.Screen}`);
  if (detail.CustomProperties) lines.push(`CustomProperties: ${detail.CustomProperties}`);
  lines.push("");

  return lines.join("\n");
}
