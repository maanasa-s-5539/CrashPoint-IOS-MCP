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

interface ManifestEntry {
  processedAt: string;
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

  isProcessed(crashId: string): boolean {
    const data = this.load();
    return crashId in data.entries;
  }

  markProcessed(crashId: string): void {
    const data = this.load();
    data.entries[crashId] = { processedAt: new Date().toISOString() };
    this.save();
  }

  getAll(): Record<string, { processedAt: string }> {
    return this.load().entries;
  }

  removeProcessed(crashId: string): void {
    const data = this.load();
    delete data.entries[crashId];
    this.save();
  }

  removeProcessedBatch(crashIds: string[]): void {
    if (crashIds.length === 0) return;
    const data = this.load();
    for (const crashId of crashIds) {
      delete data.entries[crashId];
    }
    this.save();
  }

  clear(): void {
    this.data = { entries: {} };
    this.save();
  }
}
