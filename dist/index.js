import { fileURLToPath as _fUTP } from 'url'; import { dirname as _dn } from 'path'; const __dirname = _dn(_fUTP(import.meta.url)); const __filename = _fUTP(import.meta.url);

// src/config.ts
import { z } from "zod";
import path from "path";
import fs from "fs";
function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return void 0;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
}
function loadCrashpointConfigObject() {
  if (process.env.CRASHPOINT_CONFIG_PATH) {
    return readJsonIfExists(process.env.CRASHPOINT_CONFIG_PATH) ?? {};
  }
  const parentDir = process.env.CRASH_ANALYSIS_PARENT;
  if (parentDir) {
    const configPath = path.join(parentDir, "crashpoint.config.json");
    return readJsonIfExists(configPath) ?? {};
  }
  return {};
}
var envSchema = z.object({
  CRASH_ANALYSIS_PARENT: z.string().min(1).describe("Path to ParentHolderFolder"),
  DSYM_PATH: z.string().optional().describe("Path to MyApp.dSYM"),
  APP_PATH: z.string().optional().describe("Path to MyApp.app"),
  APP_NAME: z.string().optional().describe("App binary name e.g. MyApp"),
  CRASH_INPUT_DIR: z.string().optional().describe("Override .xccrashpoint search dir"),
  CRASH_VERSIONS: z.string().optional().describe("Comma-separated version filter"),
  MASTER_BRANCH_PATH: z.string().optional().describe("Path to current master/live branch checkout"),
  DEV_BRANCH_PATH: z.string().optional().describe("Path to current development branch checkout")
});
var cachedConfig;
function getConfig() {
  if (!cachedConfig) {
    const fileCfg = loadCrashpointConfigObject();
    cachedConfig = envSchema.parse({ ...fileCfg, ...process.env });
  }
  return cachedConfig;
}
function getMainCrashLogsDir(config) {
  return path.join(config.CRASH_ANALYSIS_PARENT, "MainCrashLogsFolder");
}
function getXcodeCrashesDir(config) {
  return path.join(config.CRASH_ANALYSIS_PARENT, "MainCrashLogsFolder", "XCodeCrashLogs");
}
function getAppticsCrashesDir(config) {
  return path.join(config.CRASH_ANALYSIS_PARENT, "MainCrashLogsFolder", "AppticsCrashLogs");
}
function getOtherCrashesDir(config) {
  return path.join(config.CRASH_ANALYSIS_PARENT, "MainCrashLogsFolder", "OtherCrashLogs");
}
function getSymbolicatedDir(config) {
  return path.join(config.CRASH_ANALYSIS_PARENT, "SymbolicatedCrashLogsFolder");
}
function getAnalyzedReportsDir(config) {
  return path.join(config.CRASH_ANALYSIS_PARENT, "AnalyzedReportsFolder");
}
function getStateMaintenanceDir(config) {
  return path.join(config.CRASH_ANALYSIS_PARENT, "StateMaintenance");
}
function getAutomationDir(config) {
  return path.join(config.CRASH_ANALYSIS_PARENT, "Automation");
}
function getLatestJsonReportPath(config) {
  return path.join(getAnalyzedReportsDir(config), "latest.json");
}
function getLatestCsvReportPath(config) {
  return path.join(getAnalyzedReportsDir(config), "latest.csv");
}
function hasCrashFiles(dir) {
  return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith(".crash") || f.endsWith(".ips"));
}

// src/core/crashAnalyzer.ts
import fs3 from "fs";
import path3 from "path";

// src/state/processedManifest.ts
import fs2 from "fs";
import path2 from "path";
var MANIFEST_FILENAME = "processed_manifest.json";
var INCIDENT_ID_RE = /^Incident Identifier:\s+([0-9A-Fa-f-]+)/;
function extractIncidentId(filePath) {
  try {
    const fd = fs2.openSync(filePath, "r");
    const buf = Buffer.alloc(4096);
    const bytesRead = fs2.readSync(fd, buf, 0, 4096, 0);
    fs2.closeSync(fd);
    const content = buf.slice(0, bytesRead).toString("utf-8");
    const match = INCIDENT_ID_RE.exec(content);
    if (match) return match[1];
  } catch {
  }
  return null;
}
function emptyManifestData() {
  return { pipeline_runs: {}, export_entries: {}, symbolicate_entries: {}, analyze_entries: {} };
}
var ProcessedManifest = class {
  constructor(parentDir, stage) {
    this.data = null;
    this.manifestPath = path2.join(parentDir, "StateMaintenance", MANIFEST_FILENAME);
    this.stage = stage;
  }
  sectionKey() {
    return `${this.stage}_entries`;
  }
  load() {
    if (this.data !== null) return this.data;
    try {
      const raw = fs2.readFileSync(this.manifestPath, "utf-8");
      const parsed = JSON.parse(raw);
      this.data = {
        pipeline_runs: parsed.pipeline_runs ?? {},
        export_entries: parsed.export_entries ?? {},
        symbolicate_entries: parsed.symbolicate_entries ?? {},
        analyze_entries: parsed.analyze_entries ?? {}
      };
    } catch {
      this.data = emptyManifestData();
    }
    return this.data;
  }
  save() {
    if (this.data === null) return;
    try {
      fs2.mkdirSync(path2.dirname(this.manifestPath), { recursive: true });
      fs2.writeFileSync(this.manifestPath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch {
    }
  }
  isProcessed(crashId) {
    const data = this.load();
    return crashId in data[this.sectionKey()];
  }
  markProcessed(crashId) {
    const data = this.load();
    data[this.sectionKey()][crashId] = { processedAt: (/* @__PURE__ */ new Date()).toISOString() };
    this.save();
  }
  getAll() {
    return this.load()[this.sectionKey()];
  }
  removeProcessed(crashId) {
    const data = this.load();
    delete data[this.sectionKey()][crashId];
    this.save();
  }
  removeProcessedBatch(crashIds) {
    if (crashIds.length === 0) return;
    const data = this.load();
    for (const crashId of crashIds) {
      delete data.export_entries[crashId];
      delete data.symbolicate_entries[crashId];
      delete data.analyze_entries[crashId];
    }
    this.save();
  }
  clear() {
    this.data = emptyManifestData();
    this.save();
  }
  // ── Pipeline run tracking ──────────────────────────────────────────────────
  isPipelineRunComplete(rangeKey) {
    return rangeKey in this.load().pipeline_runs;
  }
  /**
   * Check whether the union of all existing pipeline_runs fully covers the
   * requested [startDate, endDate] range (inclusive).  Uses date comparison,
   * not string comparison.
   */
  isRangeCovered(startDate, endDate) {
    const reqStart = new Date(startDate);
    const reqEnd = new Date(endDate);
    if (isNaN(reqStart.getTime()) || isNaN(reqEnd.getTime())) return false;
    const runs = Object.values(this.load().pipeline_runs);
    if (runs.length === 0) return false;
    const sorted = runs.map((r) => ({ start: new Date(r.startDate), end: new Date(r.endDate) })).filter((r) => !isNaN(r.start.getTime()) && !isNaN(r.end.getTime())).sort((a, b) => a.start.getTime() - b.start.getTime());
    let coveredTime = reqStart.getTime();
    for (const run of sorted) {
      if (run.start.getTime() > coveredTime) break;
      if (run.end.getTime() >= coveredTime) coveredTime = run.end.getTime();
      if (coveredTime >= reqEnd.getTime()) return true;
    }
    return false;
  }
  recordPipelineRun(rangeKey, run) {
    const data = this.load();
    data.pipeline_runs[rangeKey] = run;
    this.save();
  }
  getPipelineRun(rangeKey) {
    return this.load().pipeline_runs[rangeKey];
  }
};

// src/dateValidation.ts
function validateDateInput(dateString, paramName) {
  const parsed = new Date(dateString);
  if (isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid date for ${paramName}: "${dateString}". Please use ISO format (YYYY-MM-DD), e.g. 2026-03-01`
    );
  }
  return parsed;
}

// src/core/crashAnalyzer.ts
var EXCEPTION_TYPE_RE = /^Exception Type:\s+(.+)/;
var EXCEPTION_CODES_RE = /^Exception Codes:\s+(.+)/;
var HARDWARE_MODEL_RE = /^Hardware Model:\s+(.+)/;
var OS_VERSION_RE = /^OS Version:\s+(.+)/;
var APP_VERSION_RE = /^Version:\s+(.+)/;
var CRASHED_THREAD_RE = /^Thread\s+(\d+)\s+Crashed(?::\s*(.*))?/;
var FRAME_RE = /^\s*(\d+)\s+(\S+)\s+(0x[0-9a-fA-F]+)\s+(.*)/;
var MEMORY_RE = /\s*\(.*\)\s*$/;
var ADDRESS_RE = /^0x[0-9a-fA-F]+\s+/;
function parseCrashMetadata(lines) {
  let exceptionType = "";
  let exceptionCodes = "";
  let hardwareModel = "";
  let osVersion = "";
  let appVersion = "";
  let crashedThreadId = 0;
  let crashedThreadName = "";
  let topFrames = [];
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
    if (avMatch) {
      const raw = avMatch[1].trim();
      const parenIdx = raw.indexOf(" (");
      appVersion = parenIdx !== -1 ? raw.slice(0, parenIdx) : raw;
    }
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
  const display = crashedThreadName ? `Thread ${crashedThreadId} (${crashedThreadName})` : `Thread ${crashedThreadId}`;
  return {
    exceptionType,
    exceptionCodes,
    hardwareModel,
    osVersion,
    appVersion,
    crashedThread: { id: crashedThreadId, name: crashedThreadName, display },
    topFrames
  };
}
function buildSignature(exceptionType, topFrames) {
  const cleanFrames = topFrames.slice(0, 3).map((f) => {
    return f.replace(/0x[0-9a-fA-F]+/g, "").trim();
  });
  return [exceptionType, ...cleanFrames].join("||");
}
function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}
function analyzeCrashFile(filepath) {
  try {
    const content = fs3.readFileSync(filepath, "utf-8");
    const lines = content.split("\n");
    const meta = parseCrashMetadata(lines);
    const source = detectSource(filepath);
    return { ...meta, source };
  } catch {
    return null;
  }
}
function detectSource(filepath) {
  const lower = filepath.toLowerCase();
  if (lower.includes("xccrashpoint") || lower.includes("xcode") || lower.includes("xcodecrashlogs")) return "xcode-organizer";
  if (lower.includes("apptics")) return "apptics";
  if (filepath.endsWith(".ips")) return "ips-file";
  return "manual";
}
function analyzeDirectory(crashDir, fixStatuses, manifest) {
  const groups = /* @__PURE__ */ new Map();
  let totalCrashes = 0;
  if (!fs3.existsSync(crashDir)) {
    return {
      report_date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      source_dir: crashDir,
      total_crashes: 0,
      unique_crash_types: 0,
      crash_groups: []
    };
  }
  const files = fs3.readdirSync(crashDir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips"));
  for (const file of files) {
    const filepath = path3.join(crashDir, file);
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
        signature: sig
      });
    }
    const group = groups.get(sig);
    group.count++;
    group.affected_files.push(file);
    increment(group.devices, meta.hardwareModel);
    increment(group.ios_versions, meta.osVersion);
    increment(group.app_versions, meta.appVersion);
    increment(group.sources, meta.source);
    manifest?.markProcessed(manifestKey);
  }
  const sortedGroups = Array.from(groups.values()).sort((a, b) => b.count - a.count).map((g, idx) => {
    const fs9 = fixStatuses?.[g.signature];
    return {
      ...g,
      rank: idx + 1,
      fix_status: fs9 ? { fixed: fs9.fixed, note: fs9.note } : void 0
    };
  });
  return {
    report_date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    source_dir: crashDir,
    total_crashes: totalCrashes,
    unique_crash_types: sortedGroups.length,
    crash_groups: sortedGroups
  };
}
var CRASH_DATE_RE = /^Date\/Time:\s+(.+)/m;
function parseCrashDate(content, filePath) {
  const match = CRASH_DATE_RE.exec(content);
  if (match) {
    const parsed = new Date(match[1].trim());
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return fs3.statSync(filePath).mtime;
}
function cleanOldCrashes(beforeDate, dirs, dryRun = false, parentDir, manifest) {
  const before = validateDateInput(beforeDate, "--before-date");
  const files = [];
  let deleted = 0;
  let skipped = 0;
  let totalScanned = 0;
  const deletedManifestKeys = [];
  for (const dir of dirs) {
    if (!fs3.existsSync(dir)) continue;
    const dirFiles = fs3.readdirSync(dir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips"));
    for (const file of dirFiles) {
      const filepath = path3.join(dir, file);
      totalScanned++;
      let content = "";
      try {
        content = fs3.readFileSync(filepath, "utf-8");
      } catch {
      }
      const crashDate = parseCrashDate(content, filepath);
      const shouldDelete = crashDate < before;
      const entry = {
        file: filepath,
        crashDate: crashDate.toISOString(),
        deleted: false
      };
      const incidentId = extractIncidentId(filepath);
      const manifestKey = incidentId ?? filepath;
      if (shouldDelete) {
        deletedManifestKeys.push(manifestKey);
        if (!dryRun) {
          try {
            fs3.unlinkSync(filepath);
            entry.deleted = true;
          } catch {
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
function filterUnfixedGroups(report) {
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
      unique_crash_types: unfixedGroups.length
    },
    totalFixed: fixedGroups.length,
    totalUnfixed: unfixedGroups.length
  };
}

// src/core/crashExporter.ts
import fs4 from "fs";
import path4 from "path";
var VERSION_REGEX = /^Version:\s+(.+)/;
var DATE_TIME_REGEX = /^Date\/Time:\s+(.+)/;
function extractCrashDate(crashFilePath) {
  try {
    const content = fs4.readFileSync(crashFilePath, "utf-8");
    const lines = content.split("\n").slice(0, 120);
    for (const line of lines) {
      const match = DATE_TIME_REGEX.exec(line);
      if (match) {
        const parsed = new Date(match[1].trim());
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
  } catch {
  }
  return null;
}
function extractVersion(crashFilePath) {
  try {
    const content = fs4.readFileSync(crashFilePath, "utf-8");
    const lines = content.split("\n").slice(0, 120);
    for (const line of lines) {
      const match = VERSION_REGEX.exec(line);
      if (match) {
        const raw = match[1].trim();
        const parenIdx = raw.indexOf(" (");
        return parenIdx !== -1 ? raw.slice(0, parenIdx) : raw;
      }
    }
  } catch {
  }
  return "";
}
function findCrashLogs(xccrashpointPath) {
  const results = [];
  const primaryDir = path4.join(xccrashpointPath, "DistributionInfos", "all", "logs");
  if (fs4.existsSync(primaryDir)) {
    _findCrashFiles(primaryDir, results);
    if (results.length > 0) return results;
  }
  const contentsDir = path4.join(xccrashpointPath, "Contents", "Logs");
  if (fs4.existsSync(contentsDir)) {
    _findCrashFiles(contentsDir, results);
    if (results.length > 0) return results;
  }
  _findCrashFiles(xccrashpointPath, results);
  return results;
}
function _findCrashFiles(dir, results) {
  try {
    const entries = fs4.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path4.join(dir, entry.name);
      if (entry.isDirectory()) {
        _findCrashFiles(fullPath, results);
      } else if (entry.isFile() && (entry.name.endsWith(".crash") || entry.name.endsWith(".ips"))) {
        results.push(fullPath);
      }
    }
  } catch {
  }
}
function listAvailableVersions(inputDir, recursive = false) {
  const xccrashpoints = _findXccrashpoints(inputDir, recursive);
  const versions = /* @__PURE__ */ new Set();
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
function _findXccrashpoints(dir, recursive) {
  const results = [];
  try {
    const entries = fs4.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path4.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith(".xccrashpoint")) {
          results.push(fullPath);
        } else if (recursive) {
          results.push(..._findXccrashpoints(fullPath, recursive));
        }
      }
    }
  } catch {
  }
  return results;
}
function exportCrashLogs(inputDir, outputDir, versions = [], recursive = false, dryRun = false, startDate, endDate, manifest) {
  if (startDate !== void 0) {
    validateDateInput(startDate, "--start-date");
  }
  if (endDate !== void 0) {
    validateDateInput(endDate, "--end-date");
  }
  const result = { exported: 0, skipped: 0, errors: [], files: [] };
  if (dryRun) {
    result.canBeExported = 0;
  }
  if (!fs4.existsSync(inputDir)) {
    result.errors.push(`Input directory does not exist: ${inputDir}`);
    return result;
  }
  if (!dryRun) {
    fs4.mkdirSync(outputDir, { recursive: true });
  }
  const xccrashpoints = _findXccrashpoints(inputDir, recursive);
  let counter = 1;
  for (const xcp of xccrashpoints) {
    const crashes = findCrashLogs(xcp);
    for (const crashPath of crashes) {
      const fileVersion = extractVersion(crashPath);
      const incidentId = extractIncidentId(crashPath);
      const manifestKey = incidentId ?? crashPath;
      if (manifest && manifest.isProcessed(manifestKey)) {
        result.skipped++;
        result.files.push({
          source: crashPath,
          destination: "",
          version: fileVersion,
          skipped: true,
          reason: "already processed"
        });
        continue;
      }
      if (versions.length > 0 && fileVersion) {
        const parenIndex = fileVersion.indexOf(" (");
        const shortVersion = parenIndex !== -1 ? fileVersion.slice(0, parenIndex) : fileVersion;
        if (!versions.some((v) => v === fileVersion || v === shortVersion)) {
          result.skipped++;
          result.files.push({
            source: crashPath,
            destination: "",
            version: fileVersion,
            skipped: true,
            reason: "version filtered"
          });
          continue;
        }
      }
      if (startDate !== void 0 || endDate !== void 0) {
        const crashDate = extractCrashDate(crashPath);
        if (crashDate !== null) {
          if (startDate !== void 0) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            if (crashDate < start) {
              result.skipped++;
              result.files.push({
                source: crashPath,
                destination: "",
                version: fileVersion,
                skipped: true,
                reason: "date filtered (before startDate)"
              });
              continue;
            }
          }
          if (endDate !== void 0) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            if (crashDate > end) {
              result.skipped++;
              result.files.push({
                source: crashPath,
                destination: "",
                version: fileVersion,
                skipped: true,
                reason: "date filtered (after endDate)"
              });
              continue;
            }
          }
        }
      }
      const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
      let destName = `xcodeCrashLog${counter}_${dateStr}.crash`;
      let destPath = path4.join(outputDir, destName);
      if (!dryRun) {
        const suffixes = ["", "b", "c", "d", "e", "f", "g", "h"];
        for (const suffix of suffixes) {
          const candidate = `xcodeCrashLog${counter}_${dateStr}${suffix}.crash`;
          destPath = path4.join(outputDir, candidate);
          destName = candidate;
          if (!fs4.existsSync(destPath)) break;
        }
      }
      const entry = {
        source: crashPath,
        destination: destPath,
        version: fileVersion,
        skipped: false
      };
      if (!dryRun) {
        try {
          fs4.copyFileSync(crashPath, destPath);
          result.exported++;
          counter++;
          manifest?.markProcessed(manifestKey);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to copy ${crashPath}: ${msg}`);
          entry.skipped = true;
          entry.reason = msg;
          result.skipped++;
        }
      } else {
        result.canBeExported = (result.canBeExported ?? 0) + 1;
        counter++;
      }
      result.files.push(entry);
    }
  }
  return result;
}

// src/core/symbolicator.ts
import fs5 from "fs";
import path5 from "path";
import { execFile } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
var SYMBOLICATE_CRASH = "/Applications/Xcode.app/Contents/SharedFrameworks/DVTFoundation.framework/Versions/A/Resources/symbolicatecrash";
var DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";
async function symbolicateOne(crashPath, dsymPath, outputPath) {
  if (!fs5.existsSync(crashPath)) {
    return { success: false };
  }
  if (!fs5.existsSync(dsymPath)) {
    return { success: false };
  }
  if (!fs5.existsSync(SYMBOLICATE_CRASH)) {
    return { success: false };
  }
  if (fs5.existsSync(dsymPath)) {
    dsymPath = fs5.realpathSync(dsymPath);
  }
  fs5.mkdirSync(path5.dirname(outputPath), { recursive: true });
  const env = { ...process.env, DEVELOPER_DIR };
  try {
    const { stdout } = await execFileAsync(SYMBOLICATE_CRASH, ["-d", dsymPath, crashPath], { env });
    fs5.writeFileSync(outputPath, stdout, "utf-8");
    return {
      success: true
    };
  } catch (err) {
    return { success: false };
  }
}
async function runBatch(crashDir, dsymPath, outputDir, manifest) {
  if (!fs5.existsSync(crashDir)) {
    return { succeeded: 0, failed: 0, total: 0, results: [] };
  }
  fs5.mkdirSync(outputDir, { recursive: true });
  const files = fs5.readdirSync(crashDir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips"));
  const results = [];
  let succeeded = 0;
  let failed = 0;
  for (const file of files) {
    const crashPath = path5.join(crashDir, file);
    const outputPath = path5.join(outputDir, file);
    const incidentId = extractIncidentId(crashPath);
    const manifestKey = incidentId ?? crashPath;
    if (manifest && manifest.isProcessed(manifestKey)) {
      results.push({ file, success: true });
      continue;
    }
    const res = await symbolicateOne(crashPath, dsymPath, outputPath);
    results.push({ file, ...res });
    if (res.success) {
      succeeded++;
      manifest?.markProcessed(manifestKey);
    } else {
      failed++;
    }
  }
  return { succeeded, failed, total: files.length, results };
}
async function runBatchAll(dsymPath, manifest) {
  const config = getConfig();
  const xcodeCrashDir = getXcodeCrashesDir(config);
  const appticsDir = getAppticsCrashesDir(config);
  const otherDir = getOtherCrashesDir(config);
  const outputDir = getSymbolicatedDir(config);
  let succeeded = 0;
  let failed = 0;
  let total = 0;
  const results = [];
  for (const dir of [xcodeCrashDir, appticsDir, otherDir]) {
    const r = await runBatch(dir, dsymPath, outputDir, manifest);
    succeeded += r.succeeded;
    failed += r.failed;
    total += r.total;
    results.push(...r.results);
  }
  return { succeeded, failed, total, results };
}

// src/core/csvExporter.ts
import fs6 from "fs";
import path6 from "path";
function escapeCsvValue(value) {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}
function formatAppVersions(appVersions) {
  return Object.entries(appVersions).sort(([, a], [, b]) => b - a).map(([ver, count]) => {
    const parenIdx = ver.indexOf(" (");
    const shortVer = parenIdx !== -1 ? ver.slice(0, parenIdx) : ver;
    return `${shortVer} (${count})`;
  }).join(", ");
}
function formatDevices(devices) {
  return Object.entries(devices).sort(([, a], [, b]) => b - a).map(([device, count]) => `${device} (${count})`).join(", ");
}
function formatIosVersions(iosVersions) {
  return Object.entries(iosVersions).sort(([, a], [, b]) => b - a).map(([ver, count]) => `${ver} (${count})`).join(", ");
}
function mapFixStatusLabel(group) {
  if (!group.fix_status || group.fix_status.fixed === false) {
    return "Not Fixed";
  }
  if (group.fix_status.note && group.fix_status.note.toLowerCase().includes("partial")) {
    return "Partially Fixed";
  }
  return "Fixed";
}
function buildCsvRow(group) {
  const title = `[Crash] ${group.exception_type} \u2014 ${group.crashed_thread.display} (${group.count} occurrences)`;
  const occurrences = String(group.count);
  const appVersion = formatAppVersions(group.app_versions);
  const fixStatus = mapFixStatusLabel(group);
  const signature = group.signature;
  const devices = formatDevices(group.devices);
  const iosVersions = formatIosVersions(group.ios_versions);
  return [title, occurrences, appVersion, fixStatus, signature, devices, iosVersions].map(escapeCsvValue).join(",");
}
var CSV_HEADER = ["Issue Name", "Number of Occurrences", "App Version", "Fix Status", "Signature", "iOS Devices", "iOS Version Numbers"].map(escapeCsvValue).join(",");
function reportToCsvString(report) {
  const rows = report.crash_groups.map((group) => buildCsvRow(group));
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}
function exportReportToCsv(report, outputPath) {
  try {
    const csv = reportToCsvString(report);
    const dir = path6.dirname(outputPath);
    if (dir && dir !== ".") {
      fs6.mkdirSync(dir, { recursive: true });
    }
    fs6.writeFileSync(outputPath, csv, "utf-8");
    return {
      success: true,
      message: `CSV exported successfully with ${report.crash_groups.length} row(s).`,
      filePath: outputPath,
      totalRows: report.crash_groups.length
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to export CSV: ${msg}`,
      filePath: outputPath,
      totalRows: 0
    };
  }
}

// src/core/setup.ts
import fs7 from "fs";
import path8 from "path";

// src/pathSafety.ts
import path7 from "path";
function assertPathUnderBase(userPath, base) {
  const resolved = path7.resolve(userPath);
  const resolvedBase = path7.resolve(base);
  if (!resolved.startsWith(resolvedBase + path7.sep) && resolved !== resolvedBase) {
    throw new Error(`Path "${userPath}" is outside the allowed directory "${base}"`);
  }
  return resolved;
}
function assertWritePathUnderBase(writePath, config) {
  const resolved = path7.resolve(writePath);
  const resolvedBase = path7.resolve(config.CRASH_ANALYSIS_PARENT);
  if (!resolved.startsWith(resolvedBase + path7.sep) && resolved !== resolvedBase) {
    throw new Error(
      `Write operation rejected: path "${writePath}" is outside ParentHolderFolder "${config.CRASH_ANALYSIS_PARENT}"`
    );
  }
  return resolved;
}
function assertNoTraversal(userPath) {
  if (userPath.includes("..")) {
    throw new Error(`Path "${userPath}" contains directory traversal`);
  }
  return path7.resolve(userPath);
}
var BLOCKED_PREFIXES = ["/etc", "/var/run", "/usr/bin", "/usr/sbin", "/System", "/Library/LaunchDaemons"];
function assertSafeSymlinkTarget(target) {
  const resolved = path7.resolve(target);
  for (const prefix of BLOCKED_PREFIXES) {
    if (resolved.startsWith(prefix + "/") || resolved === prefix) {
      throw new Error(`Symlink target "${target}" points to a restricted system directory`);
    }
  }
}

// src/core/automationTemplates.ts
var RUN_CRASH_PIPELINE_SH = `#!/bin/bash
set -euo pipefail

# \u2500\u2500\u2500 DERIVE PATHS FROM SCRIPT LOCATION \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# \u2500\u2500\u2500 LOGS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
LOG_DIR="$SCRIPT_DIR/ScheduledRunLogs"
mkdir -p "$LOG_DIR"

# \u2500\u2500\u2500 LOAD CONFIG FILE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
PARENT_HOLDER_FOLDER="{{PARENT_HOLDER_FOLDER}}"
CONFIG_JSON="$PARENT_HOLDER_FOLDER/crashpoint.config.json"

if [ ! -f "$CONFIG_JSON" ]; then
  echo "ERROR: Config file not found at $CONFIG_JSON"
  exit 1
fi

# Validate that the config file contains valid JSON
if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$CONFIG_JSON" 2>/dev/null; then
  echo "ERROR: Config file at $CONFIG_JSON contains invalid JSON"
  exit 1
fi

# Read automation variables FROM config file
APP_DISPLAY_NAME=$(node -e "console.log(require(process.argv[1]).APP_DISPLAY_NAME || '')" "$CONFIG_JSON")
APPTICS_MCP_NAME=$(node -e "console.log(require(process.argv[1]).APPTICS_MCP_NAME || '')" "$CONFIG_JSON")
PROJECTS_MCP_NAME=$(node -e "console.log(require(process.argv[1]).PROJECTS_MCP_NAME || '')" "$CONFIG_JSON")
CRASH_VERSIONS=$(node -e "console.log(require(process.argv[1]).CRASH_VERSIONS || '')" "$CONFIG_JSON")

# \u2500\u2500\u2500 PRE-STEP: Clear latest report pointer copies only \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# Removes ONLY latest.json/latest.csv (the stable pointers/copies)
# Keeps all timestamped history (jsonReport_<ts>.json, sheetReport_<ts>.csv)
ANALYZED_DIR="$PARENT_HOLDER_FOLDER/AnalyzedReportsFolder"
LATEST_JSON="$ANALYZED_DIR/latest.json"
LATEST_CSV="$ANALYZED_DIR/latest.csv"

if [ -f "$LATEST_JSON" ]; then
  rm -f "$LATEST_JSON"
  echo "Cleared $LATEST_JSON"
fi
if [ -f "$LATEST_CSV" ]; then
  rm -f "$LATEST_CSV"
  echo "Cleared $LATEST_CSV"
fi

mkdir -p "$ANALYZED_DIR"

# \u2500\u2500\u2500 CLAUDE CLI PATH \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# Edit this to the path of your Claude CLI binary
CLAUDE_PATH="<REPLACE_WITH_CLAUDE_CLI_PATH>"

# \u2500\u2500\u2500 PROMPT TEMPLATE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
PROMPT_FILE="$SCRIPT_DIR/daily_crash_pipeline_prompt.md"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "ERROR: Prompt template not found at $PROMPT_FILE"
  exit 1
fi

if [ ! -x "$CLAUDE_PATH" ]; then
  echo "ERROR: Claude CLI not found or not executable at $CLAUDE_PATH"
  exit 1
fi

# \u2500\u2500\u2500 COMPUTE TARGET DATE (N days ago, macOS date syntax) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
CRASH_DATE_OFFSET=$(node -e "console.log(require(process.argv[1]).CRASH_DATE_OFFSET || '3')" "$CONFIG_JSON")
TARGET_DATE=$(date -v-\${CRASH_DATE_OFFSET}d +"%Y-%m-%d")

# \u2500\u2500\u2500 SUBSTITUTE PLACEHOLDERS FROM config file \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
PROMPT=$(sed \\
  -e "s|{{APP_DISPLAY_NAME}}|\${APP_DISPLAY_NAME}|g" \\
  -e "s|{{APPTICS_MCP_NAME}}|\${APPTICS_MCP_NAME}|g" \\
  -e "s|{{PROJECTS_MCP_NAME}}|\${PROJECTS_MCP_NAME}|g" \\
  -e "s|{{CRASH_VERSIONS}}|\${CRASH_VERSIONS}|g" \\
  -e "s|{{TARGET_DATE}}|\${TARGET_DATE}|g" \\
  "$PROMPT_FILE")

# \u2500\u2500\u2500 BUILD --allowedTools DYNAMICALLY FROM config file MCP NAMES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ALLOWED_TOOLS="mcp__crashpoint-ios__*,mcp__crashpoint-integrations__*,mcp__claude_ai_\${APPTICS_MCP_NAME}__*,mcp__claude_ai_\${PROJECTS_MCP_NAME}__*"

# \u2500\u2500\u2500 TIMESTAMP & LOG FILE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="$LOG_DIR/pipeline_\${TIMESTAMP}.log"

{
  echo "=== Crash Pipeline Run: $TIMESTAMP ==="
  echo "App:           \${APP_DISPLAY_NAME}"
  echo "Version:       \${CRASH_VERSIONS}"
  echo "Target Date:   \${TARGET_DATE} (offset: \${CRASH_DATE_OFFSET} days)"
  echo "Apptics MCP:   \${APPTICS_MCP_NAME}"
  echo "Projects MCP:  \${PROJECTS_MCP_NAME}"
  echo "Allowed Tools: \${ALLOWED_TOOLS}"
  echo "---"
} | tee "$LOG_FILE"

# \u2500\u2500\u2500 cd INTO ParentHolderFolder (so Claude picks up .mcp.json) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
cd "$PARENT_HOLDER_FOLDER"

# \u2500\u2500\u2500 RUN PIPELINE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
"$CLAUDE_PATH" -p "$PROMPT" \\
  --allowedTools "$ALLOWED_TOOLS" \\
  --max-turns 30 \\
  2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=\${PIPESTATUS[0]}

if [ "$EXIT_CODE" -ne 0 ]; then
  echo "ERROR: Pipeline failed with exit code $EXIT_CODE" | tee -a "$LOG_FILE"
fi

echo "=== Pipeline Complete ===" | tee -a "$LOG_FILE"
exit "$EXIT_CODE"
`;
var DAILY_CRASH_PIPELINE_PROMPT_MD = `You are running an automated daily crash analysis pipeline. Execute these steps in order, stopping if any step fails:

## Step 1: Download Crashes from Apptics
Use the {{APPTICS_MCP_NAME}} MCP server. Fetch all crashes and crash details for {{APP_DISPLAY_NAME}} iOS app, for the version number {{CRASH_VERSIONS}} from {{TARGET_DATE}} only (a single day). Save the crash details to 'AppticsCrash_<number>.crash' text files in 'AppticsCrashLogs/' directory.

## Step 2: Export Crash Logs
Use CrashPoint-IOS-MCP to run the full pipeline with startDate={{TARGET_DATE}} and endDate={{TARGET_DATE}} so only crashes from that single day are exported.

## Step 3: Notify Cliq
Use the Crashpoint-integrations-mcp. Using the analyzed latest.json inside ParentHolderFolder -> AnalyzedReportsFolder , notify_cliq about all the crashes from the latest report.

## Step 4: Create/Update Bugs in Zoho Projects
Use the Crashpoint-integrations-mcp and {{PROJECTS_MCP_NAME}} MCPs and the latest report. Use the portal id, project id and field id values from the config file. Use these tools from {{PROJECTS_MCP_NAME}} MCP : getProjectsIssues, createProjectIssue, updateIssue.
If an issue with the same crash signature and app version number does not exist already, create a new issue, setting the App Version and Number of Occurrences field values.
If an issue with the same crash signature exists already, update the existing crash's number of occurrences. Take the existing value in the number of occurrences field, add the new number of occurrences to it and update the field.

After completing all steps, output a summary of what was processed.
`;
var MCP_JSON_EXAMPLE = `{
  "mcpServers": {
    "crashpoint-ios": {
      "command": "npx",
      "args": ["-p", "github:maanasa-s-5539/CrashPoint-IOS-MCP", "crashpoint-ios-core"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "{{PARENT_HOLDER_FOLDER}}",
        "DSYM_PATH": "<REPLACE_WITH_DSYM_PATH>",
        "APP_PATH": "<REPLACE_WITH_APP_PATH>",
        "APP_NAME": "<REPLACE_WITH_APP_NAME>",
        "MASTER_BRANCH_PATH": "<REPLACE_WITH_MASTER_BRANCH_PATH>",
        "DEV_BRANCH_PATH": "<REPLACE_WITH_DEV_BRANCH_PATH>"
      }
    },
    "crashpoint-integrations": {
      "command": "npx",
      "args": ["-p", "github:maanasa-s-5539/CrashPoint-Integrations-MCP", "crashpoint-integrations"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "{{PARENT_HOLDER_FOLDER}}",
        "ZOHO_CLIQ_WEBHOOK_URL": "<REPLACE_WITH_CLIQ_WEBHOOK_URL>",
        "ZOHO_PROJECTS_PORTAL_ID": "<REPLACE_WITH_PORTAL_ID>",
        "ZOHO_PROJECTS_PROJECT_ID": "<REPLACE_WITH_PROJECT_ID>",
        "ZOHO_BUG_STATUS_OPEN": "<REPLACE_WITH_STATUS_ID>",
        "ZOHO_BUG_APP_VERSION": "<REPLACE_WITH_FIELD_NAME>",
        "ZOHO_BUG_NUM_OF_OCCURRENCES": "<REPLACE_WITH_FIELD_NAME>",
        "CRASH_VERSIONS": "<REPLACE_WITH_APP_VERSION>"
      }
    }
  }
}
`;
var COM_CRASHPIPELINE_DAILY_PLIST_EXAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.crashpipeline.daily_mcp</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string><REPLACE_WITH_PATH_TO>/automation/run_crash_pipeline.sh</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>/tmp/crashpipeline_stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/crashpipeline_stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
        <key>HOME</key>
        <string><REPLACE_WITH_HOME_DIR></string>
    </dict>
</dict>
</plist>
`;
function getAutomationTemplates(parentDir) {
  const fill = (content) => content.replaceAll("{{PARENT_HOLDER_FOLDER}}", parentDir);
  return [
    {
      filename: "run_crash_pipeline.sh",
      content: fill(RUN_CRASH_PIPELINE_SH),
      executable: true
    },
    {
      filename: "daily_crash_pipeline_prompt.md",
      content: DAILY_CRASH_PIPELINE_PROMPT_MD,
      executable: false
    },
    {
      filename: ".mcp.json.example",
      content: fill(MCP_JSON_EXAMPLE),
      executable: false
    },
    {
      filename: "com.crashpipeline.daily_mcp.plist.example",
      content: COM_CRASHPIPELINE_DAILY_PLIST_EXAMPLE,
      executable: false
    }
  ];
}

// src/core/setup.ts
function setupWorkspace(options = {}) {
  const config = getConfig();
  const parentDir = config.CRASH_ANALYSIS_PARENT;
  const mainCrashDir = getMainCrashLogsDir(config);
  const xcodeCrashDir = getXcodeCrashesDir(config);
  const appticsDir = getAppticsCrashesDir(config);
  const otherDir = getOtherCrashesDir(config);
  const symbolicatedDir = getSymbolicatedDir(config);
  const created = [];
  const warnings = [];
  const dirsToCreate = [
    parentDir,
    mainCrashDir,
    xcodeCrashDir,
    appticsDir,
    otherDir,
    symbolicatedDir,
    getAnalyzedReportsDir(config),
    getStateMaintenanceDir(config),
    getAutomationDir(config)
  ];
  for (const dir of dirsToCreate) {
    if (!fs7.existsSync(dir)) {
      fs7.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }
  const automationDir = getAutomationDir(config);
  const scaffoldedFiles = [];
  const templates = getAutomationTemplates(parentDir);
  for (const { filename, content, executable } of templates) {
    const destPath = path8.join(automationDir, filename);
    if (!fs7.existsSync(destPath)) {
      fs7.writeFileSync(destPath, content, "utf-8");
      if (executable) {
        fs7.chmodSync(destPath, 493);
      }
      scaffoldedFiles.push(destPath);
    }
  }
  const symlinkDefs = [
    { name: "CurrentMasterLiveBranch", target: options.masterBranchPath ?? config.MASTER_BRANCH_PATH },
    { name: "CurrentDevelopmentBranch", target: options.devBranchPath ?? config.DEV_BRANCH_PATH },
    { name: "dSYM_File", target: options.dsymPath ?? config.DSYM_PATH },
    { name: "app_File", target: options.appPath ?? config.APP_PATH }
  ];
  const symlinks = [];
  for (const { name, target } of symlinkDefs) {
    if (!target) continue;
    assertNoTraversal(target);
    assertSafeSymlinkTarget(target);
    const resolvedTarget = path8.resolve(target);
    const linkPath = path8.join(parentDir, name);
    let status;
    if (!fs7.existsSync(resolvedTarget)) {
      warnings.push(`Target for ${name} does not exist: ${resolvedTarget}`);
    }
    try {
      fs7.lstatSync(linkPath);
      fs7.rmSync(linkPath, { force: true });
    } catch {
    }
    let symlinkType = "file";
    if (fs7.existsSync(resolvedTarget)) {
      symlinkType = fs7.statSync(resolvedTarget).isDirectory() ? "dir" : "file";
    } else {
      const lowerTarget = resolvedTarget.toLowerCase();
      if (lowerTarget.endsWith(".dsym") || lowerTarget.endsWith(".app") || lowerTarget.endsWith(".framework") || !path8.extname(resolvedTarget)) {
        symlinkType = "dir";
      }
    }
    try {
      fs7.symlinkSync(resolvedTarget, linkPath, symlinkType);
      status = "created";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      status = `failed: ${msg}`;
      warnings.push(`Could not create symlink ${name}: ${msg}`);
    }
    symlinks.push({ link: linkPath, target: resolvedTarget, status });
  }
  return { parentDir, created, symlinks, scaffoldedFiles, warnings };
}

// src/state/fixTracker.ts
import fs8 from "fs";
import path9 from "path";
var FixTracker = class {
  constructor(parentDir) {
    this.filePath = path9.join(parentDir, "StateMaintenance", "fix_status.json");
  }
  load() {
    try {
      if (fs8.existsSync(this.filePath)) {
        const raw = fs8.readFileSync(this.filePath, "utf-8");
        return JSON.parse(raw);
      }
    } catch {
    }
    return {};
  }
  save(store) {
    fs8.mkdirSync(path9.dirname(this.filePath), { recursive: true });
    fs8.writeFileSync(this.filePath, JSON.stringify(store, null, 2), "utf-8");
  }
  setFixed(signature, fixed, note) {
    const store = this.load();
    const status = {
      fixed,
      note,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    store[signature] = status;
    this.save(store);
    return status;
  }
  getStatus(signature) {
    return this.load()[signature];
  }
  getAll() {
    const store = this.load();
    return Object.entries(store).map(([sig, status]) => ({
      signature: sig,
      ...status
    }));
  }
  remove(signature) {
    const store = this.load();
    if (signature in store) {
      delete store[signature];
      this.save(store);
      return true;
    }
    return false;
  }
};
function loadFixStatuses(parentDir) {
  const tracker = new FixTracker(parentDir);
  const result = {};
  for (const entry of tracker.getAll()) {
    result[entry.signature] = { fixed: entry.fixed, note: entry.note };
  }
  return result;
}
export {
  FixTracker,
  ProcessedManifest,
  analyzeCrashFile,
  analyzeDirectory,
  assertNoTraversal,
  assertPathUnderBase,
  assertSafeSymlinkTarget,
  assertWritePathUnderBase,
  buildSignature,
  cleanOldCrashes,
  detectSource,
  exportCrashLogs,
  exportReportToCsv,
  extractIncidentId,
  filterUnfixedGroups,
  getAnalyzedReportsDir,
  getAppticsCrashesDir,
  getAutomationDir,
  getConfig,
  getLatestCsvReportPath,
  getLatestJsonReportPath,
  getMainCrashLogsDir,
  getOtherCrashesDir,
  getStateMaintenanceDir,
  getSymbolicatedDir,
  getXcodeCrashesDir,
  hasCrashFiles,
  listAvailableVersions,
  loadFixStatuses,
  parseCrashMetadata,
  reportToCsvString,
  runBatch,
  runBatchAll,
  setupWorkspace,
  symbolicateOne
};
