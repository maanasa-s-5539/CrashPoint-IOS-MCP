import fs from "fs";
import path from "path";
import type { CrashGroup, CrashReport } from "./crashAnalyzer.js";

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

/** Map fix_status to a human-readable label: Fixed, Not Fixed, or Partially Fixed. */
function mapFixStatusLabel(group: CrashGroup): string {
  if (!group.fix_status || group.fix_status.fixed === false) {
    return "Not Fixed";
  }
  // fixed === true — check if note mentions "partial"
  if (group.fix_status.note && group.fix_status.note.toLowerCase().includes("partial")) {
    return "Partially Fixed";
  }
  return "Fixed";
}

/** Build a single CSV row (without trailing newline) for a crash group. */
function buildCsvRow(group: CrashGroup): string {
  const title = `[Crash] ${group.exception_type} — ${group.crashed_thread.display} (${group.count} occurrences)`;
  const occurrences = String(group.count);
  const appVersion = formatAppVersions(group.app_versions);
  const fixStatus = mapFixStatusLabel(group);

  return [title, occurrences, appVersion, fixStatus]
    .map(escapeCsvValue)
    .join(",");
}

// ── Public API ────────────────────────────────────────────────────────────────

const CSV_HEADER = ["Issue Name", "Number of Occurrences", "App Version", "Fix Status"]
  .map(escapeCsvValue)
  .join(",");

/**
 * Build and return the CSV content as a string without writing to disk.
 */
export function reportToCsvString(report: CrashReport): string {
  const rows = report.crash_groups.map((group) => buildCsvRow(group));
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}

/**
 * Export the crash analysis report as a CSV file.
 * Returns a result object describing success/failure, the file path, and total rows written.
 */
export function exportReportToCsv(
  report: CrashReport,
  outputPath: string
): CsvExportResult {
  try {
    const csv = reportToCsvString(report);
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
