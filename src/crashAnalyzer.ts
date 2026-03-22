import fs from "fs";
import path from "path";

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
}

export interface CrashReport {
  report_date: string;
  source_dir: string;
  total_crashes: number;
  unique_crash_types: number;
  crash_groups: CrashGroup[];
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

function detectSource(filepath: string): string {
  const lower = filepath.toLowerCase();
  if (lower.includes("xccrashpoint") || lower.includes("xcode")) return "xcode-organizer";
  if (lower.includes("apptics")) return "apptics";
  if (filepath.endsWith(".ips")) return "ips-file";
  return "manual";
}

export function analyzeDirectory(
  crashDir: string,
  fixStatuses?: Record<string, { fixed: boolean; note?: string }>
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
  }

  const sortedGroups = Array.from(groups.values())
    .sort((a, b) => b.count - a.count)
    .map((g, idx) => ({ ...g, rank: idx + 1 }));

  return {
    report_date: new Date().toISOString().slice(0, 10),
    source_dir: crashDir,
    total_crashes: totalCrashes,
    unique_crash_types: sortedGroups.length,
    crash_groups: sortedGroups,
  };
}
