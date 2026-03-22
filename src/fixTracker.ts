import fs from "fs";
import path from "path";

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

export class FixTracker {
  private filePath: string;

  constructor(parentDir: string) {
    this.filePath = path.join(parentDir, "fix_status.json");
  }

  private load(): FixStatusStore {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        return JSON.parse(raw) as FixStatusStore;
      }
    } catch {
      // corrupt file — start fresh
    }
    return {};
  }

  private save(store: FixStatusStore): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(store, null, 2), "utf-8");
  }

  setFixed(signature: string, fixed: boolean, note?: string): FixStatus {
    const store = this.load();
    const status: FixStatus = {
      fixed,
      note,
      updatedAt: new Date().toISOString(),
    };
    store[signature] = status;
    this.save(store);
    return status;
  }

  getStatus(signature: string): FixStatus | undefined {
    return this.load()[signature];
  }

  getAll(): FixStatusEntry[] {
    const store = this.load();
    return Object.entries(store).map(([sig, status]) => ({
      signature: sig,
      ...status,
    }));
  }

  remove(signature: string): boolean {
    const store = this.load();
    if (signature in store) {
      delete store[signature];
      this.save(store);
      return true;
    }
    return false;
  }
}
