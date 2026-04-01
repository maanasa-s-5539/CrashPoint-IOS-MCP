import fs from "fs";
import path from "path";

const MANIFEST_FILENAME = "processed_manifest.json";

const INCIDENT_ID_RE = /^Incident Identifier:\s+([0-9A-Fa-f-]+)/;

/**
 * Read the first ~4 KB of a crash file and return the Incident Identifier
 * UUID, or null if not found (e.g. non-standard / .ips format without it).
 */
export function extractIncidentId(filePath: string): string | null {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    const content = buf.slice(0, bytesRead).toString("utf-8");
    const match = INCIDENT_ID_RE.exec(content);
    if (match) return match[1];
  } catch {
    // ignore read errors
  }
  return null;
}

export type ManifestStage = "export" | "symbolicate" | "analyze";

interface ManifestEntry {
  processedAt: string;
}

export interface PipelineRun {
  startDate: string;
  endDate: string;
  completedAt: string;
  crashIds: string[];
  exportedCount: number;
  symbolicatedCount: number;
  analyzedCount: number;
  reportPath?: string;
}

interface ManifestData {
  pipeline_runs: Record<string, PipelineRun>;
  export_entries: Record<string, ManifestEntry>;
  symbolicate_entries: Record<string, ManifestEntry>;
  analyze_entries: Record<string, ManifestEntry>;
}

function emptyManifestData(): ManifestData {
  return { pipeline_runs: {}, export_entries: {}, symbolicate_entries: {}, analyze_entries: {} };
}

export class ProcessedManifest {
  private manifestPath: string;
  private data: ManifestData | null = null;
  private stage: ManifestStage;

  constructor(parentDir: string, stage: ManifestStage) {
    this.manifestPath = path.join(parentDir, "StateMaintenance", MANIFEST_FILENAME);
    this.stage = stage;
  }

  private sectionKey(): "export_entries" | "symbolicate_entries" | "analyze_entries" {
    return `${this.stage}_entries` as "export_entries" | "symbolicate_entries" | "analyze_entries";
  }

  private load(): ManifestData {
    if (this.data !== null) return this.data;
    try {
      const raw = fs.readFileSync(this.manifestPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<ManifestData>;
      this.data = {
        pipeline_runs: parsed.pipeline_runs ?? {},
        export_entries: parsed.export_entries ?? {},
        symbolicate_entries: parsed.symbolicate_entries ?? {},
        analyze_entries: parsed.analyze_entries ?? {},
      };
    } catch {
      this.data = emptyManifestData();
    }
    return this.data;
  }

  private save(): void {
    if (this.data === null) return;
    try {
      fs.mkdirSync(path.dirname(this.manifestPath), { recursive: true });
      fs.writeFileSync(this.manifestPath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch {
      // ignore write errors
    }
  }

  isProcessed(crashId: string): boolean {
    const data = this.load();
    return crashId in data[this.sectionKey()];
  }

  markProcessed(crashId: string): void {
    const data = this.load();
    data[this.sectionKey()][crashId] = { processedAt: new Date().toISOString() };
    this.save();
  }

  getAll(): Record<string, { processedAt: string }> {
    return this.load()[this.sectionKey()];
  }

  removeProcessed(crashId: string): void {
    const data = this.load();
    delete data[this.sectionKey()][crashId];
    this.save();
  }

  removeProcessedBatch(crashIds: string[]): void {
    if (crashIds.length === 0) return;
    const data = this.load();
    for (const crashId of crashIds) {
      delete data.export_entries[crashId];
      delete data.symbolicate_entries[crashId];
      delete data.analyze_entries[crashId];
    }
    this.save();
  }

  clear(): void {
    this.data = emptyManifestData();
    this.save();
  }

  // ── Pipeline run tracking ──────────────────────────────────────────────────

  isPipelineRunComplete(rangeKey: string): boolean {
    return rangeKey in this.load().pipeline_runs;
  }

  /**
   * Check whether the union of all existing pipeline_runs fully covers the
   * requested [startDate, endDate] range (inclusive).  Uses date comparison,
   * not string comparison.
   */
  isRangeCovered(startDate: string, endDate: string): boolean {
    const reqStart = new Date(startDate);
    const reqEnd = new Date(endDate);
    if (isNaN(reqStart.getTime()) || isNaN(reqEnd.getTime())) return false;

    const runs = Object.values(this.load().pipeline_runs);
    if (runs.length === 0) return false;

    // Sort runs by their startDate
    const sorted = runs
      .map((r) => ({ start: new Date(r.startDate), end: new Date(r.endDate) }))
      .filter((r) => !isNaN(r.start.getTime()) && !isNaN(r.end.getTime()))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    // Walk through sorted runs trying to tile [reqStart, reqEnd]
    let coveredTime = reqStart.getTime();
    for (const run of sorted) {
      if (run.start.getTime() > coveredTime) break; // gap — cannot tile further
      if (run.end.getTime() >= coveredTime) coveredTime = run.end.getTime();
      if (coveredTime >= reqEnd.getTime()) return true;
    }
    return false;
  }

  recordPipelineRun(rangeKey: string, run: PipelineRun): void {
    const data = this.load();
    data.pipeline_runs[rangeKey] = run;
    this.save();
  }

  getPipelineRun(rangeKey: string): PipelineRun | undefined {
    return this.load().pipeline_runs[rangeKey];
  }
}
