import fs from "fs";
import path from "path";
import { ProcessedManifest, extractIncidentId } from "../state/processedManifest.js";
import { validateDateInput } from "../dateValidation.js";

export interface CrashedThread {
  id: number;
  name: string;
  display: string;
}

export interface CrashGroup {
  rank: number;
  count: number;
  exception_type: string;
  exception_codes: string;
  crashed_thread: CrashedThread;
  top_frames: string[];
  devices: Record<string, number>;
  ios_versions: Record<string, number>;
  app_versions: Record<string, number>;
  sources: Record<string, number>;
  affected_files: string[];
  signature: string;
  fix_status?: { fixed: boolean; note?: string; date?: string };
}

export interface CrashReport {
  report_date: string;
  source_dir: string;
  total_crashes: number;
  unique_crash_types: number;
  crash_groups: CrashGroup[];
  report_type?: string;
}

export interface CrashMetadata {
  exceptionType: string;
  exceptionCodes: string;
  hardwareModel: string;
  osVersion: string;
  appVersion: string;
  crashedThread: CrashedThread;
  topFrames: string[];
}

const EXCEPTION_TYPE_RE = /^Exception Type:\s+(.+)/;
const EXCEPTION_CODES_RE = /^Exception Codes:\s+(.+)/;
const HARDWARE_MODEL_RE = /^Hardware Model:\s+(.+)/;
const OS_VERSION_RE = /^OS Version:\s+(.+)/;
const APP_VERSION_RE = /^Version:\s+(.+)/;
const CRASHED_THREAD_RE = /^Thread\s+(\d+)\s+Crashed(?::\s*(.*))?/;
const FRAME_RE = /^\s*(\d+)\s+(\S+)\s+(0x[0-9a-fA-F]+)\s+(.*)/;
const MEMORY_RE = /\s*\(.*\)\s*$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]+\s+/;

export function parseCrashMetadata(lines: string[]): CrashMetadata {
  let exceptionType = "";
  let exceptionCodes = "";
  let hardwareModel = "";
  let osVersion = "";
  let appVersion = "";
  let crashedThreadId = 0;
  let crashedThreadName = "";
  let topFrames: string[] = [];
  let inCrashedThread = false;
  let crashedThreadFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const etMatch = EXCEPTION_TYPE_RE.exec(line);
    if (etMatch) exceptionType = etMatch[1].trim();

    const ecMatch = EXCEPTION_CODES_RE.exec(line);
    if (ecMatch) exceptionCodes = ecMatch[1].trim();

    const hmMatch = HARDWARE_MODEL_RE.exec(line);
    if (hmMatch) hardwareModel = hmMatch[1].trim();

    const ovMatch = OS_VERSION_RE.exec(line);
    if (ovMatch) osVersion = ovMatch[1].trim();

    const avMatch = APP_VERSION_RE.exec(line);
    if (avMatch) appVersion = avMatch[1].trim();

    const ctMatch = CRASHED_THREAD_RE.exec(line);
    if (ctMatch && !crashedThreadFound) {
      crashedThreadId = parseInt(ctMatch[1], 10);
      crashedThreadName = ctMatch[2]?.trim() ?? "";
      crashedThreadFound = true;
      inCrashedThread = true;
      continue;
    }

    if (inCrashedThread && topFrames.length < 3) {
      if (line.trim() === "") {
        inCrashedThread = false;
        continue;
      }
      const frameMatch = FRAME_RE.exec(line);
      if (frameMatch) {
        let symbol = frameMatch[4].trim();
        symbol = symbol.replace(MEMORY_RE, "").replace(ADDRESS_RE, "").trim();
        topFrames.push(`${frameMatch[2]}  ${symbol}`);
      }
    }
  }

  const display = crashedThreadName
    ? `Thread ${crashedThreadId} (${crashedThreadName})`
    : `Thread ${crashedThreadId}`;

  return {
    exceptionType,
    exceptionCodes,
    hardwareModel,
    osVersion,
    appVersion,
    crashedThread: { id: crashedThreadId, name: crashedThreadName, display },
    topFrames,
  };
}

export function buildSignature(exceptionType: string, topFrames: string[]): string {
  const cleanFrames = topFrames.slice(0, 3).map((f) => {
    return f.replace(/0x[0-9a-fA-F]+/g, "").trim();
  });
  return [exceptionType, ...cleanFrames].join("||");
}

function increment(map: Record<string, number>, key: string): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}

export function analyzeCrashFile(filepath: string): (CrashMetadata & { source: string }) | null {
  try {
    const content = fs.readFileSync(filepath, "utf-8");
    const lines = content.split("\n");
    const meta = parseCrashMetadata(lines);
    const source = detectSource(filepath);
    return { ...meta, source };
  } catch {
    return null;
  }
}

export function detectSource(filepath: string): string {
  const lower = filepath.toLowerCase();
  if (lower.includes("xccrashpoint") || lower.includes("xcode") || lower.includes("xcodecrashlogs")) return "xcode-organizer";
  if (lower.includes("apptics")) return "apptics";
  if (filepath.endsWith(".ips")) return "ips-file";
  return "manual";
}

export function analyzeDirectory(
  crashDir: string,
  fixStatuses?: Record<string, { fixed: boolean; note?: string }>,
  manifest?: ProcessedManifest
): CrashReport {
  const groups = new Map<string, CrashGroup>();
  let totalCrashes = 0;

  if (!fs.existsSync(crashDir)) {
    return {
      report_date: new Date().toISOString().slice(0, 10),
      source_dir: crashDir,
      total_crashes: 0,
      unique_crash_types: 0,
      crash_groups: [],
    };
  }

  const files = fs.readdirSync(crashDir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips"));

  for (const file of files) {
    const filepath = path.join(crashDir, file);

    const incidentId = extractIncidentId(filepath);
    const manifestKey = incidentId ?? filepath;
    if (manifest && manifest.isProcessed(manifestKey)) {
      continue;
    }

    const meta = analyzeCrashFile(filepath);
    if (!meta) continue;

    totalCrashes++;
    const sig = buildSignature(meta.exceptionType, meta.topFrames);

    if (!groups.has(sig)) {
      groups.set(sig, {
        rank: 0,
        count: 0,
        exception_type: meta.exceptionType,
        exception_codes: meta.exceptionCodes,
        crashed_thread: meta.crashedThread,
        top_frames: meta.topFrames,
        devices: {},
        ios_versions: {},
        app_versions: {},
        sources: {},
        affected_files: [],
        signature: sig,
      });
    }

    const group = groups.get(sig)!;
    group.count++;
    group.affected_files.push(file);
    increment(group.devices, meta.hardwareModel);
    increment(group.ios_versions, meta.osVersion);
    increment(group.app_versions, meta.appVersion);
    increment(group.sources, meta.source);

    manifest?.markProcessed(manifestKey);
  }

  const sortedGroups = Array.from(groups.values())
    .sort((a, b) => b.count - a.count)
    .map((g, idx) => {
      const fs = fixStatuses?.[g.signature];
      return {
        ...g,
        rank: idx + 1,
        fix_status: fs ? { fixed: fs.fixed, note: fs.note } : undefined,
      };
    });

  return {
    report_date: new Date().toISOString().slice(0, 10),
    source_dir: crashDir,
    total_crashes: totalCrashes,
    unique_crash_types: sortedGroups.length,
    crash_groups: sortedGroups,
  };
}

// ── cleanOldCrashes ───────────────────────────────────────────────────────────

const CRASH_DATE_RE = /^Date\/Time:\s+(.+)/m;

export interface CleanFileEntry {
  file: string;
  crashDate: string;
  deleted: boolean;
}

export interface CleanResult {
  deleted: number;
  skipped: number;
  totalScanned: number;
  files: CleanFileEntry[];
}

function parseCrashDate(content: string, filePath: string): Date {
  const match = CRASH_DATE_RE.exec(content);
  if (match) {
    const parsed = new Date(match[1].trim());
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return fs.statSync(filePath).mtime;
}

export function cleanOldCrashes(beforeDate: string, dirs: string[], dryRun = false, parentDir?: string, manifest?: ProcessedManifest): CleanResult {
  const before = validateDateInput(beforeDate, "--before-date");
  const files: CleanFileEntry[] = [];
  let deleted = 0;
  let skipped = 0;
  let totalScanned = 0;
  const deletedManifestKeys: string[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const dirFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips"));

    for (const file of dirFiles) {
      const filepath = path.join(dir, file);
      totalScanned++;
      let content = "";
      try {
        content = fs.readFileSync(filepath, "utf-8");
      } catch {
        // fallback to mtime
      }
      const crashDate = parseCrashDate(content, filepath);
      const shouldDelete = crashDate < before;
      const entry: CleanFileEntry = {
        file: filepath,
        crashDate: crashDate.toISOString(),
        deleted: false,
      };
      const incidentId = extractIncidentId(filepath);
      const manifestKey = incidentId ?? filepath;

      if (shouldDelete) {
        if (!dryRun) {
          try {
            fs.unlinkSync(filepath);
            entry.deleted = true;
            deletedManifestKeys.push(manifestKey);
          } catch {
            // skip if cannot delete
          }
        } else {
          entry.deleted = true; // would be deleted in a real run
        }
        deleted++;
      } else {
        skipped++;
      }
      files.push(entry);
    }
  }

  // Also clean report_<timestamp>.json files from parentDir
  const REPORT_RE = /^report_(\d+)\.json$/;
  if (parentDir && fs.existsSync(parentDir)) {
    const reportFiles = fs.readdirSync(parentDir).filter((f) => REPORT_RE.test(f));
    for (const file of reportFiles) {
      const match = REPORT_RE.exec(file);
      if (!match) continue;
      const ts = parseInt(match[1], 10);
      const fileDate = new Date(ts);
      const filepath = path.join(parentDir, file);
      totalScanned++;
      const shouldDelete = fileDate < before;
      const entry: CleanFileEntry = {
        file: filepath,
        crashDate: fileDate.toISOString(),
        deleted: false,
      };

      if (shouldDelete) {
        if (!dryRun) {
          try {
            fs.unlinkSync(filepath);
            entry.deleted = true;
          } catch {
            // skip if cannot delete
          }
        } else {
          entry.deleted = true;
        }
        deleted++;
      } else {
        skipped++;
      }
      files.push(entry);
    }
  }

  if (manifest) {
    manifest.removeProcessedBatch(deletedManifestKeys);
  }

  return { deleted, skipped, totalScanned, files };
}

// ── filterUnfixedGroups ───────────────────────────────────────────────────────

export function filterUnfixedGroups(report: CrashReport): { filtered: CrashReport; totalFixed: number; totalUnfixed: number } {
  const fixedGroups = report.crash_groups.filter((g) => g.fix_status?.fixed === true);
  const unfixedGroups = report.crash_groups.filter(
    (g) => !g.fix_status || g.fix_status.fixed === false
  );
  return {
    filtered: {
      ...report,
      report_type: "unfixed-only",
      crash_groups: unfixedGroups.map((g, idx) => ({ ...g, rank: idx + 1 })),
      total_crashes: unfixedGroups.reduce((sum, g) => sum + g.count, 0),
      unique_crash_types: unfixedGroups.length,
    },
    totalFixed: fixedGroups.length,
    totalUnfixed: unfixedGroups.length,
  };
}
