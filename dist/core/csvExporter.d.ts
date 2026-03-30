import type { CrashReport } from "./crashAnalyzer.js";
export interface CsvExportResult {
    success: boolean;
    message: string;
    filePath: string;
    totalRows: number;
}
/**
 * Build and return the CSV content as a string without writing to disk.
 */
export declare function reportToCsvString(report: CrashReport): string;
/**
 * Export the crash analysis report as a CSV file.
 * Returns a result object describing success/failure, the file path, and total rows written.
 */
export declare function exportReportToCsv(report: CrashReport, outputPath: string): CsvExportResult;
//# sourceMappingURL=csvExporter.d.ts.map