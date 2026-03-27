import fs from "fs";
import path from "path";
import type { CrashGroup, CrashReport } from "./crashAnalyzer.js";
import {
  buildDescription,
  mapSeverityId,
  mapStatusId,
  type ZohoBugFieldIds,
} from "./zohoProjectsMcpBridge.js";

// ── Result Type ───────────────────────────────────────────────────────────────

export interface CsvExportResult {
  success: boolean;
  message: string;
  filePath: string;
  totalRows: number;
}

// ── CSV Helpers ───────────────────────────────────────────────────────────────

/** Escape a value for CSV: wrap in double-quotes and escape internal double-quotes. */
function escapeCsvValue(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

/** Format app_versions record as "version (count), ..." sorted descending by count. */
function formatAppVersions(appVersions: Record<string, number>): string {
  return Object.entries(appVersions)
    .sort(([, a], [, b]) => b - a)
    .map(([ver, count]) => `${ver} (${count})`)
    .join(", ");
}

/** Build a single CSV row (without trailing newline) for a crash group. */
function buildCsvRow(group: CrashGroup, report: CrashReport, fieldIds: ZohoBugFieldIds): string {
  const title = `[Crash] ${group.exception_type} — ${group.crashed_thread.display} (${group.count} occurrences)`;
  const occurrences = String(group.count);
  const appVersion = formatAppVersions(group.app_versions);
  const description = buildDescription(group, report);
  const severity = mapSeverityId(group, fieldIds).label;
  const status = mapStatusId(group, fieldIds).label;

  return [title, occurrences, appVersion, description, severity, status]
    .map(escapeCsvValue)
    .join(",");
}

// ── Public API ────────────────────────────────────────────────────────────────

const CSV_HEADER = ["Issue Name", "Number of occurrences", "App Version", "Description", "Severity", "Status"]
  .map(escapeCsvValue)
  .join(",");

/**
 * Build and return the CSV content as a string without writing to disk.
 */
export function reportToCsvString(report: CrashReport, fieldIds: ZohoBugFieldIds = {}): string {
  const rows = report.crash_groups.map((group) => buildCsvRow(group, report, fieldIds));
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}

/**
 * Export the crash analysis report as a CSV file.
 * Returns a result object describing success/failure, the file path, and total rows written.
 */
export function exportReportToCsv(
  report: CrashReport,
  outputPath: string,
  fieldIds: ZohoBugFieldIds = {}
): CsvExportResult {
  try {
    const csv = reportToCsvString(report, fieldIds);
    const dir = path.dirname(outputPath);
    if (dir && dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, csv, "utf-8");
    return {
      success: true,
      message: `CSV exported successfully with ${report.crash_groups.length} row(s).`,
      filePath: outputPath,
      totalRows: report.crash_groups.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to export CSV: ${msg}`,
      filePath: outputPath,
      totalRows: 0,
    };
  }
}
