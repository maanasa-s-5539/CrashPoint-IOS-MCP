import fs from "fs";
import path from "path";

const MANIFEST_FILENAME = "processed_manifest.json";

interface ManifestEntry {
  processedAt: string;
  startDate?: string;
  endDate?: string;
}

interface ManifestData {
  entries: Record<string, ManifestEntry>;
}

export class ProcessedManifest {
  private manifestPath: string;
  private data: ManifestData | null = null;

  constructor(parentDir: string) {
    this.manifestPath = path.join(parentDir, MANIFEST_FILENAME);
  }

  private load(): ManifestData {
    if (this.data !== null) return this.data;
    try {
      const raw = fs.readFileSync(this.manifestPath, "utf-8");
      this.data = JSON.parse(raw) as ManifestData;
    } catch {
      this.data = { entries: {} };
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

  isProcessed(crashId: string, startDate?: string, endDate?: string): boolean {
    const data = this.load();
    const entry = data.entries[crashId];
    if (!entry) return false;

    // If caller provides a date range, check that it matches what was stored.
    // If the range differs, treat the crash as not yet processed for the new range.
    if (startDate !== undefined || endDate !== undefined) {
      if (entry.startDate !== startDate || entry.endDate !== endDate) {
        return false;
      }
    } else {
      // No date range provided for the check — only consider it processed if
      // the stored entry also had no date range.
      if (entry.startDate !== undefined || entry.endDate !== undefined) {
        return false;
      }
    }

    return true;
  }

  markProcessed(crashId: string, startDate?: string, endDate?: string): void {
    const data = this.load();
    const entry: ManifestEntry = { processedAt: new Date().toISOString() };
    if (startDate !== undefined) entry.startDate = startDate;
    if (endDate !== undefined) entry.endDate = endDate;
    data.entries[crashId] = entry;
    this.save();
  }

  getAll(): Record<string, { processedAt: string; startDate?: string; endDate?: string }> {
    return this.load().entries;
  }

  clear(): void {
    this.data = { entries: {} };
    this.save();
  }
}
