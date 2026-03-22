import fs from "fs";
import path from "path";

export interface ExportEntry {
  source: string;
  destination: string;
  version: string;
  skipped: boolean;
  reason?: string;
}

export interface ExportResult {
  exported: number;
  skipped: number;
  errors: string[];
  files: ExportEntry[];
}

const VERSION_REGEX = /^Version:\s+(.+)/;
const SHORT_VERSION_REGEX = /^(.+?)\s+\((\d+)\)$/;

export function extractVersion(crashFilePath: string): string {
  try {
    const content = fs.readFileSync(crashFilePath, "utf-8");
    const lines = content.split("\n").slice(0, 120);
    for (const line of lines) {
      const match = VERSION_REGEX.exec(line);
      if (match) {
        return match[1].trim();
      }
    }
  } catch {
    // ignore read errors
  }
  return "";
}

export function detectCrashSource(filepath: string): string {
  const lower = filepath.toLowerCase();
  if (lower.includes("xccrashpoint") || lower.includes("xcode")) {
    return "xcode-organizer";
  }
  if (lower.includes("apptics")) {
    return "apptics";
  }
  if (filepath.endsWith(".ips")) {
    return "ips-file";
  }
  return "manual";
}

export function findCrashLogs(xccrashpointPath: string): string[] {
  const results: string[] = [];

  // Try DistributionInfos/all/logs/ first
  const primaryDir = path.join(xccrashpointPath, "DistributionInfos", "all", "logs");
  if (fs.existsSync(primaryDir)) {
    _findCrashFiles(primaryDir, results);
    if (results.length > 0) return results;
  }

  // Try Contents/Logs/
  const contentsDir = path.join(xccrashpointPath, "Contents", "Logs");
  if (fs.existsSync(contentsDir)) {
    _findCrashFiles(contentsDir, results);
    if (results.length > 0) return results;
  }

  // Fallback: recursive search
  _findCrashFiles(xccrashpointPath, results);
  return results;
}

function _findCrashFiles(dir: string, results: string[]): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        _findCrashFiles(fullPath, results);
      } else if (entry.isFile() && (entry.name.endsWith(".crash") || entry.name.endsWith(".ips"))) {
        results.push(fullPath);
      }
    }
  } catch {
    // ignore permission errors
  }
}

export function listAvailableVersions(inputDir: string, recursive = false): string[] {
  const xccrashpoints = _findXccrashpoints(inputDir, recursive);
  const versions = new Set<string>();

  for (const xcp of xccrashpoints) {
    const crashes = findCrashLogs(xcp);
    for (const crash of crashes) {
      const version = extractVersion(crash);
      if (version) {
        versions.add(version);
      }
    }
  }

  return Array.from(versions).sort();
}

function _findXccrashpoints(dir: string, recursive: boolean): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith(".xccrashpoint")) {
          results.push(fullPath);
        } else if (recursive) {
          results.push(..._findXccrashpoints(fullPath, recursive));
        }
      }
    }
  } catch {
    // ignore
  }
  return results;
}

export function exportCrashLogs(
  inputDir: string,
  outputDir: string,
  versions: string[] = [],
  recursive = false,
  dryRun = false
): ExportResult {
  const result: ExportResult = { exported: 0, skipped: 0, errors: [], files: [] };

  if (!fs.existsSync(inputDir)) {
    result.errors.push(`Input directory does not exist: ${inputDir}`);
    return result;
  }

  if (!dryRun) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const xccrashpoints = _findXccrashpoints(inputDir, recursive);
  let counter = 1;

  for (const xcp of xccrashpoints) {
    const crashes = findCrashLogs(xcp);
    for (const crashPath of crashes) {
      const fileVersion = extractVersion(crashPath);

      // Version filter
      if (versions.length > 0 && fileVersion && !versions.includes(fileVersion)) {
        result.skipped++;
        result.files.push({
          source: crashPath,
          destination: "",
          version: fileVersion,
          skipped: true,
          reason: "version filtered",
        });
        continue;
      }

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      let destName = `xcodeCrashLog${counter}_${dateStr}.crash`;
      let destPath = path.join(outputDir, destName);

      // Handle collisions
      if (!dryRun) {
        const suffixes = ["", "b", "c", "d", "e", "f", "g", "h"];
        for (const suffix of suffixes) {
          const candidate = `xcodeCrashLog${counter}_${dateStr}${suffix}.crash`;
          destPath = path.join(outputDir, candidate);
          destName = candidate;
          if (!fs.existsSync(destPath)) break;
        }
      }

      const entry: ExportEntry = {
        source: crashPath,
        destination: destPath,
        version: fileVersion,
        skipped: false,
      };

      if (!dryRun) {
        try {
          fs.copyFileSync(crashPath, destPath);
          result.exported++;
          counter++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to copy ${crashPath}: ${msg}`);
          entry.skipped = true;
          entry.reason = msg;
          result.skipped++;
        }
      } else {
        result.exported++;
        counter++;
      }

      result.files.push(entry);
    }
  }

  return result;
}
