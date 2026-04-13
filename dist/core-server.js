#!/usr/bin/env node
import { fileURLToPath as _fUTP } from 'url'; import { dirname as _dn } from 'path'; const __dirname = _dn(_fUTP(import.meta.url)); const __filename = _fUTP(import.meta.url);

// src/core-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z as z2 } from "zod";
import fs10 from "fs";
import path12 from "path";
import { execFile as execFile2 } from "child_process";
import { promisify as promisify2 } from "util";

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
  CLAUDE_CLI_PATH: z.string().optional().describe("Absolute path to the Claude CLI binary"),
  DSYM_PATH: z.string().optional().describe("Path to MyApp.dSYM"),
  APP_PATH: z.string().optional().describe("Path to MyApp.app"),
  APP_NAME: z.string().optional().describe("App binary name e.g. MyApp"),
  CRASH_INPUT_DIR: z.string().optional().describe("Override .xccrashpoint search dir"),
  CRASH_VERSIONS: z.string().optional().describe("Comma-separated version filter"),
  CRASH_NUM_DAYS: z.string().optional().describe("Number of days to process (1\u2013180, default: 1)"),
  CRASH_DATE_OFFSET: z.string().optional().describe("Days offset from today for end date (default: 4)"),
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
function hasCrashFiles(dir) {
  return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith(".crash") || f.endsWith(".ips"));
}

// src/core/crashExporter.ts
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
function computeDateRange(numDays, dateOffset) {
  const n = Math.max(1, Math.min(numDays, 180));
  const endDate = /* @__PURE__ */ new Date();
  endDate.setDate(endDate.getDate() - dateOffset);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - n + 1);
  return {
    startDateISO: startDate.toISOString().slice(0, 10),
    endDateISO: endDate.toISOString().slice(0, 10)
  };
}

// src/core/crashExporter.ts
var VERSION_REGEX = /^Version:\s+(.+)/;
var DATE_TIME_REGEX = /^Date\/Time:\s+(.+)/;
function extractCrashDate(crashFilePath) {
  try {
    const content = fs3.readFileSync(crashFilePath, "utf-8");
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
    const content = fs3.readFileSync(crashFilePath, "utf-8");
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
  const primaryDir = path3.join(xccrashpointPath, "DistributionInfos", "all", "logs");
  if (fs3.existsSync(primaryDir)) {
    _findCrashFiles(primaryDir, results);
    if (results.length > 0) return results;
  }
  const contentsDir = path3.join(xccrashpointPath, "Contents", "Logs");
  if (fs3.existsSync(contentsDir)) {
    _findCrashFiles(contentsDir, results);
    if (results.length > 0) return results;
  }
  _findCrashFiles(xccrashpointPath, results);
  return results;
}
function _findCrashFiles(dir, results) {
  try {
    const entries = fs3.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path3.join(dir, entry.name);
      if (entry.isDirectory()) {
        _findCrashFiles(fullPath, results);
      } else if (entry.isFile() && (entry.name.endsWith(".crash") || entry.name.endsWith(".ips"))) {
        results.push(fullPath);
      }
    }
  } catch {
  }
}
function _findXccrashpoints(dir, recursive) {
  const results = [];
  try {
    const entries = fs3.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path3.join(dir, entry.name);
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
  if (!fs3.existsSync(inputDir)) {
    result.errors.push(`Input directory does not exist: ${inputDir}`);
    return result;
  }
  if (!dryRun) {
    fs3.mkdirSync(outputDir, { recursive: true });
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
      let destPath = path3.join(outputDir, destName);
      if (!dryRun) {
        const suffixes = ["", "b", "c", "d", "e", "f", "g", "h"];
        for (const suffix of suffixes) {
          const candidate = `xcodeCrashLog${counter}_${dateStr}${suffix}.crash`;
          destPath = path3.join(outputDir, candidate);
          destName = candidate;
          if (!fs3.existsSync(destPath)) break;
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
          fs3.copyFileSync(crashPath, destPath);
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
import fs4 from "fs";
import path4 from "path";
import { execFile } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
var SYMBOLICATE_CRASH = "/Applications/Xcode.app/Contents/SharedFrameworks/DVTFoundation.framework/Versions/A/Resources/symbolicatecrash";
var DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";
async function symbolicateOne(crashPath, dsymPath, outputPath) {
  if (!fs4.existsSync(crashPath)) {
    return { success: false };
  }
  if (!fs4.existsSync(dsymPath)) {
    return { success: false };
  }
  if (!fs4.existsSync(SYMBOLICATE_CRASH)) {
    return { success: false };
  }
  if (fs4.existsSync(dsymPath)) {
    dsymPath = fs4.realpathSync(dsymPath);
  }
  fs4.mkdirSync(path4.dirname(outputPath), { recursive: true });
  const env = { ...process.env, DEVELOPER_DIR };
  try {
    const { stdout } = await execFileAsync(SYMBOLICATE_CRASH, ["-d", dsymPath, crashPath], { env });
    fs4.writeFileSync(outputPath, stdout, "utf-8");
    return {
      success: true
    };
  } catch (err) {
    return { success: false };
  }
}
async function runBatch(crashDir, dsymPath, outputDir, manifest) {
  if (!fs4.existsSync(crashDir)) {
    return { succeeded: 0, failed: 0, total: 0, results: [] };
  }
  fs4.mkdirSync(outputDir, { recursive: true });
  const files = fs4.readdirSync(crashDir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips"));
  const results = [];
  let succeeded = 0;
  let failed = 0;
  for (const file of files) {
    const crashPath = path4.join(crashDir, file);
    const outputPath = path4.join(outputDir, file);
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
async function symbolicateFiles(files, dsymPath, outputDir, manifest) {
  fs4.mkdirSync(outputDir, { recursive: true });
  const results = [];
  let succeeded = 0;
  let failed = 0;
  for (const crashPath of files) {
    const file = path4.basename(crashPath);
    const outputPath = path4.join(outputDir, file);
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

// src/core/crashAnalyzer.ts
import fs5 from "fs";
import path5 from "path";
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
    const content = fs5.readFileSync(filepath, "utf-8");
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
  if (!fs5.existsSync(crashDir)) {
    return {
      report_date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      source_dir: crashDir,
      total_crashes: 0,
      unique_crash_types: 0,
      crash_groups: []
    };
  }
  const files = fs5.readdirSync(crashDir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips"));
  for (const file of files) {
    const filepath = path5.join(crashDir, file);
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
    const fs11 = fixStatuses?.[g.signature];
    return {
      ...g,
      rank: idx + 1,
      fix_status: fs11 ? { fixed: fs11.fixed, note: fs11.note } : void 0
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
function analyzeFiles(files, fixStatuses, manifest) {
  const groups = /* @__PURE__ */ new Map();
  let totalCrashes = 0;
  for (const filepath of files) {
    if (!fs5.existsSync(filepath)) continue;
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
    group.affected_files.push(path5.basename(filepath));
    increment(group.devices, meta.hardwareModel);
    increment(group.ios_versions, meta.osVersion);
    increment(group.app_versions, meta.appVersion);
    increment(group.sources, meta.source);
    manifest?.markProcessed(manifestKey);
  }
  const sortedGroups = Array.from(groups.values()).sort((a, b) => b.count - a.count).map((g, idx) => {
    const fs22 = fixStatuses?.[g.signature];
    return {
      ...g,
      rank: idx + 1,
      fix_status: fs22 ? { fixed: fs22.fixed, note: fs22.note } : void 0
    };
  });
  return {
    report_date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    source_dir: files.length > 0 ? path5.dirname(files[0]) : "multiple sources",
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
  return fs5.statSync(filePath).mtime;
}
function cleanOldCrashes(beforeDate, dirs, dryRun = false, parentDir, manifest) {
  const before = validateDateInput(beforeDate, "--before-date");
  const files = [];
  let deleted = 0;
  let skipped = 0;
  let totalScanned = 0;
  const deletedManifestKeys = [];
  for (const dir of dirs) {
    if (!fs5.existsSync(dir)) continue;
    const dirFiles = fs5.readdirSync(dir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips"));
    for (const file of dirFiles) {
      const filepath = path5.join(dir, file);
      totalScanned++;
      let content = "";
      try {
        content = fs5.readFileSync(filepath, "utf-8");
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
            fs5.unlinkSync(filepath);
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

// src/core/reportCleaner.ts
import fs6 from "fs";
import path6 from "path";
function getReportDate(filename, filepath) {
  const match = /^(?:jsonReport|sheetReport)_(\d+)\.(json|csv)$/.exec(filename);
  if (match) {
    const ms = parseInt(match[1], 10);
    if (!isNaN(ms)) return new Date(ms);
  }
  return fs6.statSync(filepath).mtime;
}
function cleanOldReports(beforeDate, reportsDir, dryRun = false) {
  const before = validateDateInput(beforeDate, "--before-date");
  const files = [];
  let deleted = 0;
  let skipped = 0;
  let totalScanned = 0;
  if (!fs6.existsSync(reportsDir)) {
    return { deleted, skipped, totalScanned, files };
  }
  const allFiles = fs6.readdirSync(reportsDir).filter((f) => {
    if (f === "latest.json" || f === "latest.csv") return false;
    return f.endsWith(".json") || f.endsWith(".csv");
  });
  for (const filename of allFiles) {
    const filepath = path6.join(reportsDir, filename);
    totalScanned++;
    const reportDate = getReportDate(filename, filepath);
    const shouldDelete = reportDate < before;
    const entry = {
      file: filepath,
      reportDate: reportDate.toISOString(),
      deleted: false
    };
    if (shouldDelete) {
      if (!dryRun) {
        try {
          fs6.unlinkSync(filepath);
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
  return { deleted, skipped, totalScanned, files };
}

// src/state/fixTracker.ts
import fs7 from "fs";
import path7 from "path";
var FixTracker = class {
  constructor(parentDir) {
    this.filePath = path7.join(parentDir, "StateMaintenance", "fix_status.json");
  }
  load() {
    try {
      if (fs7.existsSync(this.filePath)) {
        const raw = fs7.readFileSync(this.filePath, "utf-8");
        return JSON.parse(raw);
      }
    } catch {
    }
    return {};
  }
  save(store) {
    fs7.mkdirSync(path7.dirname(this.filePath), { recursive: true });
    fs7.writeFileSync(this.filePath, JSON.stringify(store, null, 2), "utf-8");
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

// src/pathSafety.ts
import path8 from "path";
function assertPathUnderBase(userPath, base) {
  const resolved = path8.resolve(userPath);
  const resolvedBase = path8.resolve(base);
  if (!resolved.startsWith(resolvedBase + path8.sep) && resolved !== resolvedBase) {
    throw new Error(`Path "${userPath}" is outside the allowed directory "${base}"`);
  }
  return resolved;
}
function assertNoTraversal(userPath) {
  if (userPath.includes("..")) {
    throw new Error(`Path "${userPath}" contains directory traversal`);
  }
  return path8.resolve(userPath);
}
var BLOCKED_PREFIXES = ["/etc", "/var/run", "/usr/bin", "/usr/sbin", "/System", "/Library/LaunchDaemons"];
function assertSafeSymlinkTarget(target) {
  const resolved = path8.resolve(target);
  for (const prefix of BLOCKED_PREFIXES) {
    if (resolved.startsWith(prefix + "/") || resolved === prefix) {
      throw new Error(`Symlink target "${target}" points to a restricted system directory`);
    }
  }
}

// src/core/csvExporter.ts
import fs8 from "fs";
import path9 from "path";
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
    const dir = path9.dirname(outputPath);
    if (dir && dir !== ".") {
      fs8.mkdirSync(dir, { recursive: true });
    }
    fs8.writeFileSync(outputPath, csv, "utf-8");
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
import fs9 from "fs";
import os2 from "os";
import path11 from "path";

// src/core/automationTemplates.ts
import os from "os";
import path10 from "path";
function generateMcpJson(config) {
  const getConfigValue = (k) => config[k] ?? "";
  const json = {
    mcpServers: {
      "crashpoint-ios": {
        command: "npx",
        args: ["-p", "github:maanasa-s-5539/CrashPoint-IOS-MCP", "crashpoint-ios-core"],
        env: {
          CRASH_ANALYSIS_PARENT: getConfigValue("CRASH_ANALYSIS_PARENT"),
          DSYM_PATH: getConfigValue("DSYM_PATH"),
          APP_PATH: getConfigValue("APP_PATH"),
          APP_NAME: getConfigValue("APP_NAME"),
          MASTER_BRANCH_PATH: getConfigValue("MASTER_BRANCH_PATH"),
          DEV_BRANCH_PATH: getConfigValue("DEV_BRANCH_PATH")
        }
      },
      "crashpoint-integrations": {
        command: "npx",
        args: ["-p", "github:maanasa-s-5539/CrashPoint-Integrations-MCP", "crashpoint-integrations"],
        env: {
          CRASH_ANALYSIS_PARENT: getConfigValue("CRASH_ANALYSIS_PARENT"),
          ZOHO_CLIQ_WEBHOOK_URL: getConfigValue("ZOHO_CLIQ_WEBHOOK_URL"),
          ZOHO_PROJECTS_PORTAL_ID: getConfigValue("ZOHO_PROJECTS_PORTAL_ID"),
          ZOHO_PROJECTS_PROJECT_ID: getConfigValue("ZOHO_PROJECTS_PROJECT_ID"),
          ZOHO_BUG_STATUS_OPEN: getConfigValue("ZOHO_BUG_STATUS_OPEN"),
          ZOHO_BUG_APP_VERSION: getConfigValue("ZOHO_BUG_APP_VERSION"),
          ZOHO_BUG_NUM_OF_OCCURRENCES: getConfigValue("ZOHO_BUG_NUM_OF_OCCURRENCES"),
          CRASH_VERSIONS: getConfigValue("CRASH_VERSIONS")
        }
      }
    }
  };
  return JSON.stringify(json, null, 2);
}
function generatePlist(config) {
  const scriptPath = path10.join(config.CRASH_ANALYSIS_PARENT, "Automation", "run_crash_pipeline.sh");
  const homeDir = os.homedir();
  const scheduledRunTime = config.SCHEDULED_RUN_TIME ?? "11:00";
  const timeParts = scheduledRunTime.split(":");
  const parsedHour = parseInt(timeParts[0] ?? "11", 10);
  const parsedMinute = parseInt(timeParts[1] ?? "0", 10);
  const hour = !isNaN(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 11;
  const minute = !isNaN(parsedMinute) && parsedMinute >= 0 && parsedMinute <= 59 ? parsedMinute : 0;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.crashpipeline.daily_mcp</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${scriptPath}</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>${hour}</integer>
        <key>Minute</key>
        <integer>${minute}</integer>
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
        <string>${homeDir}</string>
    </dict>
</dict>
</plist>`;
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
    getAutomationDir(config),
    path11.join(getAutomationDir(config), "FixPlans")
  ];
  for (const dir of dirsToCreate) {
    if (!fs9.existsSync(dir)) {
      fs9.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }
  const scaffoldedFiles = [];
  const configJsonPath = path11.join(parentDir, "crashpoint.config.json");
  let rawConfig = {};
  if (fs9.existsSync(configJsonPath)) {
    try {
      rawConfig = JSON.parse(fs9.readFileSync(configJsonPath, "utf-8"));
    } catch {
    }
  }
  const fullConfig = {
    ...rawConfig,
    CRASH_ANALYSIS_PARENT: config.CRASH_ANALYSIS_PARENT,
    DSYM_PATH: config.DSYM_PATH,
    APP_PATH: config.APP_PATH,
    APP_NAME: config.APP_NAME,
    MASTER_BRANCH_PATH: config.MASTER_BRANCH_PATH,
    DEV_BRANCH_PATH: config.DEV_BRANCH_PATH,
    CRASH_VERSIONS: config.CRASH_VERSIONS
  };
  const mcpJsonPath = path11.join(parentDir, ".mcp.json");
  if (!fs9.existsSync(mcpJsonPath)) {
    fs9.writeFileSync(mcpJsonPath, generateMcpJson(fullConfig), "utf-8");
    scaffoldedFiles.push(mcpJsonPath);
  }
  const launchAgentsDir = path11.join(os2.homedir(), "Library", "LaunchAgents");
  const plistPath = path11.join(launchAgentsDir, "com.crashpipeline.daily_mcp.plist");
  if (!fs9.existsSync(plistPath)) {
    try {
      if (!fs9.existsSync(launchAgentsDir)) {
        fs9.mkdirSync(launchAgentsDir, { recursive: true });
      }
      fs9.writeFileSync(plistPath, generatePlist(fullConfig), "utf-8");
      scaffoldedFiles.push(plistPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not write launchd plist to ${plistPath}: ${msg}`);
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
    const resolvedTarget = path11.resolve(target);
    const linkPath = path11.join(parentDir, name);
    let status;
    if (!fs9.existsSync(resolvedTarget)) {
      warnings.push(`Target for ${name} does not exist: ${resolvedTarget}`);
    }
    try {
      fs9.lstatSync(linkPath);
      fs9.rmSync(linkPath, { force: true });
    } catch {
    }
    let symlinkType = "file";
    if (fs9.existsSync(resolvedTarget)) {
      symlinkType = fs9.statSync(resolvedTarget).isDirectory() ? "dir" : "file";
    } else {
      const lowerTarget = resolvedTarget.toLowerCase();
      if (lowerTarget.endsWith(".dsym") || lowerTarget.endsWith(".app") || lowerTarget.endsWith(".framework") || !path11.extname(resolvedTarget)) {
        symlinkType = "dir";
      }
    }
    try {
      fs9.symlinkSync(resolvedTarget, linkPath, symlinkType);
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

// src/core-server.ts
var execFileAsync2 = promisify2(execFile2);
var server = new McpServer({
  name: "crashpoint-ios-core",
  version: "1.0.0"
});
server.registerTool(
  "setup_folders",
  {
    description: "Create the ParentHolderFolder directory structure (MainCrashLogsFolder/XCodeCrashLogs, MainCrashLogsFolder/AppticsCrashLogs, MainCrashLogsFolder/OtherCrashLogs, SymbolicatedCrashLogsFolder, AnalyzedReportsFolder, StateMaintenance, Automation, Automation/FixPlans) and optional symlinks for master/dev branches. All symlink paths are pre-configured via environment variables \u2014 do NOT ask the user for them unless they explicitly want to override.",
    inputSchema: z2.object({
      masterBranchPath: z2.string().optional().describe("ALREADY CONFIGURED via MASTER_BRANCH_PATH env var. Do NOT ask the user. Only provide to override. Creates CurrentMasterLiveBranch symlink."),
      devBranchPath: z2.string().optional().describe("ALREADY CONFIGURED via DEV_BRANCH_PATH env var. Do NOT ask the user. Only provide to override. Creates CurrentDevelopmentBranch symlink."),
      dsymPath: z2.string().optional().describe("ALREADY CONFIGURED via DSYM_PATH env var. Do NOT ask the user. Only provide to override. Creates dSYM_File symlink."),
      appPath: z2.string().optional().describe("ALREADY CONFIGURED via APP_PATH env var. Do NOT ask the user. Only provide to override. Creates app_File symlink.")
    }),
    outputSchema: z2.object({
      parentDir: z2.string(),
      created: z2.array(z2.string()),
      symlinks: z2.array(z2.object({ link: z2.string(), target: z2.string(), status: z2.string() })),
      scaffoldedFiles: z2.array(z2.string()),
      warnings: z2.array(z2.string())
    })
  },
  async (input) => {
    const result = setupWorkspace({
      masterBranchPath: input.masterBranchPath,
      devBranchPath: input.devBranchPath,
      dsymPath: input.dsymPath,
      appPath: input.appPath
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);
server.registerTool(
  "export_crashes",
  {
    description: "Export .crash files from .xccrashpoint packages into MainCrashLogsFolder/XCodeCrashLogs. When dryRun is true, shows what would be exported without writing any files.",
    inputSchema: z2.object({
      inputDir: z2.string().optional().describe("Directory to search for .xccrashpoint files"),
      outputDir: z2.string().optional().describe("Destination directory for crash logs"),
      versions: z2.string().optional().describe("Comma-separated version filter"),
      recursive: z2.boolean().optional().describe("Search subdirectories recursively"),
      numDays: z2.number().optional().describe("Number of days to process (1\u2013180). End date = today minus CRASH_DATE_OFFSET (default 4 from config), start date = end date minus numDays + 1. Overrides CRASH_NUM_DAYS in config. Default: 1."),
      dryRun: z2.boolean().optional().describe("When true, shows what would be exported without writing any files"),
      includeProcessedCrashes: z2.boolean().optional().describe("When true, re-processes crashes that were already exported. Default is false (skip already-processed crashes).")
    }),
    outputSchema: z2.object({
      canBeExported: z2.number().optional(),
      exported: z2.number(),
      skipped: z2.number(),
      errors: z2.array(z2.string()),
      files: z2.array(
        z2.object({
          source: z2.string(),
          destination: z2.string(),
          version: z2.string(),
          skipped: z2.boolean(),
          reason: z2.string().optional()
        })
      )
    })
  },
  async (input) => {
    const config = getConfig();
    const inputDir = input.inputDir ?? config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
    const outputDir = input.outputDir ?? getXcodeCrashesDir(config);
    assertNoTraversal(inputDir);
    assertPathUnderBase(outputDir, config.CRASH_ANALYSIS_PARENT);
    const versions = input.versions?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
    const recursive = input.recursive ?? false;
    const dryRun = input.dryRun ?? false;
    const manifest = dryRun || input.includeProcessedCrashes ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
    const offset = parseInt(config.CRASH_DATE_OFFSET ?? "4", 10);
    const numDays = input.numDays ?? parseInt(config.CRASH_NUM_DAYS ?? "1", 10);
    const { startDateISO, endDateISO } = computeDateRange(numDays, offset);
    const result = exportCrashLogs(inputDir, outputDir, versions, recursive, dryRun, startDateISO, endDateISO, manifest);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);
server.registerTool(
  "symbolicate_batch",
  {
    description: "Symbolicate crash files using Xcode's symbolicatecrash tool. When the optional 'file' parameter is provided, symbolicates only that single .crash file. Otherwise, processes ALL .crash and .ips files in MainCrashLogsFolder (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs), outputting to SymbolicatedCrashLogsFolder. All paths (dSYM, directories) are pre-configured via environment variables \u2014 do NOT ask the user for them unless they explicitly want to override.",
    inputSchema: z2.object({
      file: z2.string().optional().describe("Path to a single .crash or .ips file to symbolicate. When provided, only this file is processed instead of batch processing all directories."),
      dsymPath: z2.string().optional().describe("ALREADY CONFIGURED via DSYM_PATH env var. Do NOT ask the user for this. Only provide if the user explicitly wants to override the configured default."),
      outputDir: z2.string().optional().describe("ALREADY CONFIGURED via env (SymbolicatedCrashLogsFolder). Do NOT ask the user for this. Only provide to override."),
      includeProcessedCrashes: z2.boolean().optional().describe("When true, re-symbolicate crashes that were already processed. Default is false (skip already-processed crashes).")
    }),
    outputSchema: z2.object({
      succeeded: z2.number(),
      failed: z2.number(),
      total: z2.number(),
      results: z2.array(
        z2.object({
          file: z2.string(),
          success: z2.boolean()
        })
      )
    })
  },
  async (input) => {
    const config = getConfig();
    const dsymPath = input.dsymPath ?? config.DSYM_PATH;
    const outputDir = input.outputDir ?? getSymbolicatedDir(config);
    if (input.outputDir) assertPathUnderBase(input.outputDir, config.CRASH_ANALYSIS_PARENT);
    if (input.dsymPath) assertNoTraversal(input.dsymPath);
    if (!dsymPath) {
      const result2 = { succeeded: 0, failed: 0, total: 0, results: [] };
      return {
        content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
        structuredContent: result2
      };
    }
    if (input.file) {
      assertNoTraversal(input.file);
      const outputPath = path12.join(outputDir, path12.basename(input.file));
      const res = await symbolicateOne(input.file, dsymPath, outputPath);
      const result2 = {
        succeeded: res.success ? 1 : 0,
        failed: res.success ? 0 : 1,
        total: 1,
        results: [{ file: path12.basename(input.file), success: res.success }]
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
        structuredContent: result2
      };
    }
    const xcodeCrashDir = getXcodeCrashesDir(config);
    const appticsDir = getAppticsCrashesDir(config);
    const otherDir = getOtherCrashesDir(config);
    const manifest = input.includeProcessedCrashes ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "symbolicate");
    const anyFiles = hasCrashFiles(xcodeCrashDir) || hasCrashFiles(appticsDir) || hasCrashFiles(otherDir);
    if (!anyFiles) {
      const result2 = {
        succeeded: 0,
        failed: 0,
        total: 0,
        results: [],
        message: "No .crash or .ips files found in MainCrashLogsFolder/XCodeCrashLogs, MainCrashLogsFolder/AppticsCrashLogs, or MainCrashLogsFolder/OtherCrashLogs"
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
        structuredContent: { succeeded: 0, failed: 0, total: 0, results: [] }
      };
    }
    const r = await runBatchAll(dsymPath, manifest);
    const result = { succeeded: r.succeeded, failed: r.failed, total: r.total, results: r.results };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);
server.registerTool(
  "verify_dsym",
  {
    description: "Validate a .dSYM bundle and check if its UUIDs match those in crash files collected from MainCrashLogsFolder (the post-export location where XCode crash logs and other crashes live). Runs dwarfdump --uuid on the dSYM and parses Binary Images sections from crash files. Requires macOS with Xcode CLI tools. When no dsymPath is given, resolves the dSYM_File symlink in CRASH_ANALYSIS_PARENT. When no crashPath/crashDir is given, auto-collects crash files from all MainCrashLogsFolder subfolders (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs). crashDir must be within MainCrashLogsFolder. dsymPath and crashPath/crashDir must be provided together, or neither. If APP_NAME is set, only the UUID of the app binary is extracted from crash files (recommended to avoid false mismatches from system framework UUIDs).",
    inputSchema: z2.object({
      dsymPath: z2.string().optional().describe("Path to .dSYM bundle (defaults to DSYM_PATH env var, then dSYM_File symlink in CRASH_ANALYSIS_PARENT). Must be provided together with crashPath/crashDir, or omitted entirely."),
      crashPath: z2.string().optional().describe("Path to a single .crash or .ips file to compare UUIDs against. Must be provided together with dsymPath, or omitted entirely."),
      crashDir: z2.string().optional().describe("Directory of crash files to compare UUIDs against (all .crash/.ips files in the directory). Must be provided together with dsymPath, or omitted entirely.")
    }),
    outputSchema: z2.object({
      valid: z2.boolean(),
      dsymPath: z2.string(),
      dsymUuids: z2.array(z2.object({ arch: z2.string(), uuid: z2.string() })),
      crashFileUuids: z2.array(z2.object({ file: z2.string(), uuid: z2.string() })).optional(),
      matches: z2.array(z2.object({ uuid: z2.string(), arch: z2.string(), matchedFiles: z2.array(z2.string()) })).optional(),
      mismatches: z2.array(z2.string()).optional(),
      detail: z2.string()
    })
  },
  async (input) => {
    const config = getConfig();
    const hasDsymInput = Boolean(input.dsymPath);
    const hasCrashInput = Boolean(input.crashPath || input.crashDir);
    if (hasDsymInput && !hasCrashInput) {
      const result2 = {
        valid: false,
        dsymPath: input.dsymPath ?? "",
        dsymUuids: [],
        detail: "dsymPath was provided but no crashPath or crashDir was given. Either supply both or neither."
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
        structuredContent: result2
      };
    }
    if (!hasDsymInput && hasCrashInput) {
      const result2 = {
        valid: false,
        dsymPath: "",
        dsymUuids: [],
        detail: "crashPath/crashDir was provided but no dsymPath was given. Either supply both or neither."
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
        structuredContent: result2
      };
    }
    let dsymPath;
    if (input.dsymPath) {
      dsymPath = input.dsymPath;
    } else if (config.DSYM_PATH) {
      dsymPath = config.DSYM_PATH;
    } else {
      const symlinkPath = path12.join(config.CRASH_ANALYSIS_PARENT, "dSYM_File");
      try {
        dsymPath = fs10.realpathSync(symlinkPath);
      } catch {
        const result2 = {
          valid: false,
          dsymPath: "",
          dsymUuids: [],
          detail: "dsymPath not provided, DSYM_PATH env var not set, and no dSYM_File symlink found in CRASH_ANALYSIS_PARENT. Run setup to create the symlink."
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
          structuredContent: result2
        };
      }
    }
    assertNoTraversal(dsymPath);
    if (!fs10.existsSync(dsymPath)) {
      const result2 = {
        valid: false,
        dsymPath,
        dsymUuids: [],
        detail: `dSYM not found at: ${dsymPath}`
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
        structuredContent: result2
      };
    }
    let resolvedDsymPath;
    try {
      resolvedDsymPath = fs10.realpathSync(dsymPath);
    } catch {
      resolvedDsymPath = dsymPath;
    }
    let dwarfOutput = "";
    try {
      const { stdout } = await execFileAsync2("dwarfdump", ["--uuid", resolvedDsymPath]);
      dwarfOutput = stdout;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const result2 = {
        valid: false,
        dsymPath,
        dsymUuids: [],
        detail: `dwarfdump failed: ${msg}`
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
        structuredContent: result2
      };
    }
    const uuidLineRe = /UUID:\s+([0-9A-F-]+)\s+\(([^)]+)\)/gi;
    const dsymUuids = [];
    let match;
    while ((match = uuidLineRe.exec(dwarfOutput)) !== null) {
      dsymUuids.push({ uuid: match[1].toUpperCase(), arch: match[2] });
    }
    if (dsymUuids.length === 0) {
      const result2 = {
        valid: false,
        dsymPath,
        dsymUuids: [],
        detail: "dwarfdump produced no UUID output \u2014 the dSYM may be malformed."
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
        structuredContent: result2
      };
    }
    const crashFiles = [];
    if (hasCrashInput) {
      if (input.crashPath) {
        assertNoTraversal(input.crashPath);
        assertPathUnderBase(input.crashPath, getMainCrashLogsDir(config));
        crashFiles.push(input.crashPath);
      }
      if (input.crashDir) {
        assertPathUnderBase(input.crashDir, getMainCrashLogsDir(config));
        if (fs10.existsSync(input.crashDir)) {
          fs10.readdirSync(input.crashDir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips")).forEach((f) => crashFiles.push(path12.join(input.crashDir, f)));
        }
      }
    } else {
      const dirs = [
        getXcodeCrashesDir(config),
        getAppticsCrashesDir(config),
        getOtherCrashesDir(config)
      ];
      for (const dir of dirs) {
        if (fs10.existsSync(dir)) {
          fs10.readdirSync(dir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips")).forEach((f) => crashFiles.push(path12.join(dir, f)));
        }
      }
    }
    if (crashFiles.length === 0) {
      const result2 = {
        valid: true,
        dsymPath,
        dsymUuids,
        detail: `dSYM is valid. Found ${dsymUuids.length} UUID(s): ${dsymUuids.map((u) => `${u.arch}=${u.uuid}`).join(", ")}. No crash files found for UUID comparison.`
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
        structuredContent: result2
      };
    }
    const binaryImgRe = /^\s*0x[0-9a-fA-F]+\s+-\s+0x[0-9a-fA-F]+\s+(\S+)\s+\S+\s+<([0-9a-f]{32})>/gim;
    const appName = config.APP_NAME;
    const crashFileUuids = [];
    for (const crashFile of crashFiles) {
      let content = "";
      try {
        content = fs10.readFileSync(crashFile, "utf-8");
      } catch {
        continue;
      }
      const seen = /* @__PURE__ */ new Set();
      let m;
      binaryImgRe.lastIndex = 0;
      while ((m = binaryImgRe.exec(content)) !== null) {
        const binaryName = m[1];
        const rawUuid = m[2];
        if (appName && binaryName !== appName) {
          continue;
        }
        const raw = rawUuid.toUpperCase();
        const uuid = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
        if (!seen.has(uuid)) {
          seen.add(uuid);
          crashFileUuids.push({ file: path12.basename(crashFile), uuid });
        }
      }
    }
    const dsymUuidSet = new Set(dsymUuids.map((u) => u.uuid));
    const matches = [];
    const mismatches = [];
    for (const { uuid, arch } of dsymUuids) {
      const matchedFiles = crashFileUuids.filter((c) => c.uuid === uuid).map((c) => c.file);
      if (matchedFiles.length > 0) {
        matches.push({ uuid, arch, matchedFiles });
      } else {
        mismatches.push(`${arch} UUID ${uuid} not found in any provided crash file`);
      }
    }
    for (const { uuid, file } of crashFileUuids) {
      if (!dsymUuidSet.has(uuid)) {
        mismatches.push(`Crash file ${file} UUID ${uuid} not found in dSYM`);
      }
    }
    const valid = matches.length > 0 && mismatches.length === 0;
    const detail = matches.length > 0 ? `${matches.length} UUID match(es) found. ${mismatches.length > 0 ? `${mismatches.length} mismatch(es): ${mismatches.slice(0, 3).join("; ")}` : "All UUIDs matched."}` : `No UUID matches found. ${mismatches.length} mismatch(es). Symbolication will likely fail \u2014 ensure the correct dSYM for this build is used.`;
    const result = {
      valid,
      dsymPath,
      dsymUuids,
      crashFileUuids,
      matches,
      mismatches,
      detail
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);
server.registerTool(
  "analyze_crashes",
  {
    description: "Group and deduplicate symbolicated crashes by unique signature. Always reads from SymbolicatedCrashLogsFolder. Automatically generates both a JSON report (jsonReport_<timestamp>.json) and a CSV report (sheetReport_<timestamp>.csv) in AnalyzedReportsFolder. Also returns the full JSON report in the response.",
    inputSchema: z2.object({
      includeProcessedCrashes: z2.boolean().optional().describe("When true, re-analyzes crashes that were already processed. Default is false (skip already-processed crashes).")
    }),
    outputSchema: z2.object({
      report_date: z2.string(),
      source_dir: z2.string(),
      total_crashes: z2.number(),
      unique_crash_types: z2.number(),
      crash_groups: z2.array(z2.any()),
      json_report_path: z2.string(),
      csv_report_path: z2.string(),
      csv_export: z2.object({ success: z2.boolean(), message: z2.string(), filePath: z2.string(), totalRows: z2.number() }).optional()
    })
  },
  async (input) => {
    const config = getConfig();
    const crashDir = getSymbolicatedDir(config);
    const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
    const manifest = input.includeProcessedCrashes ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "analyze");
    const report = analyzeDirectory(crashDir, fixStatuses, manifest);
    const reportsDir = getAnalyzedReportsDir(config);
    fs10.mkdirSync(reportsDir, { recursive: true });
    const ts = Date.now();
    const jsonReportPath = path12.join(reportsDir, `jsonReport_${ts}.json`);
    const csvReportPath = path12.join(reportsDir, `sheetReport_${ts}.csv`);
    fs10.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2), "utf-8");
    const csvExport = exportReportToCsv(report, csvReportPath);
    const latestJsonPath = path12.join(reportsDir, "latest.json");
    const latestCsvPath = path12.join(reportsDir, "latest.csv");
    fs10.copyFileSync(jsonReportPath, latestJsonPath);
    fs10.copyFileSync(csvReportPath, latestCsvPath);
    const result = {
      ...report,
      json_report_path: jsonReportPath,
      csv_report_path: csvReportPath,
      csv_export: csvExport
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);
server.registerTool(
  "fix_status",
  {
    description: "Manage crash fix statuses. Use action='set' to mark a signature as fixed/unfixed, action='unset' to clear fix status, action='list' to show all tracked statuses.",
    inputSchema: z2.object({
      action: z2.enum(["set", "unset", "list"]).describe("Action to perform: 'set' to mark fixed/unfixed, 'unset' to mark unfixed, 'list' to show all statuses"),
      signature: z2.string().optional().describe("Crash signature string (required for set and unset actions)"),
      fixed: z2.boolean().optional().describe("Whether the crash is fixed (used with action='set', defaults to true)"),
      note: z2.string().optional().describe("Optional note (e.g. PR reference)")
    }),
    outputSchema: z2.object({
      success: z2.boolean(),
      action: z2.string(),
      result: z2.any()
    })
  },
  async (input) => {
    const config = getConfig();
    const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
    if (input.action === "list") {
      const statuses = tracker.getAll();
      const result2 = {
        success: true,
        action: "list",
        result: {
          total: statuses.length,
          fixed: statuses.filter((s) => s.fixed).length,
          unfixed: statuses.filter((s) => !s.fixed).length,
          statuses
        }
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
        structuredContent: result2
      };
    }
    if (!input.signature) {
      const result2 = {
        success: false,
        action: input.action,
        result: `signature is required for action '${input.action}'`
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
        structuredContent: result2
      };
    }
    if (input.action === "set") {
      const fixed = input.fixed ?? true;
      const status2 = tracker.setFixed(input.signature, fixed, input.note);
      const result2 = {
        success: true,
        action: "set",
        result: `Marked as ${status2.fixed ? "fixed" : "unfixed"}${status2.note ? ` \u2014 ${status2.note}` : ""} at ${status2.updatedAt}`
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result2, null, 2) }],
        structuredContent: result2
      };
    }
    const status = tracker.setFixed(input.signature, false);
    const result = {
      success: true,
      action: "unset",
      result: `Marked as unfixed at ${status.updatedAt}`
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);
server.registerTool(
  "run_basic_pipeline",
  {
    description: "Run the basic crash analysis pipeline: export \u2192 symbolicate \u2192 analyze. All paths (dSYM, app, directories) are auto-configured from environment variables \u2014 no path input is required.",
    inputSchema: z2.object({
      versions: z2.string().optional().describe("Comma-separated version filter for export"),
      numDays: z2.number().optional().describe("Number of days to process (1\u2013180). End date = today minus CRASH_DATE_OFFSET (default 4 from config), start date = end date minus numDays + 1. Overrides CRASH_NUM_DAYS in config. Default: 1."),
      includeProcessedCrashes: z2.boolean().optional().describe("When true, re-processes crashes that were already exported/symbolicated/analyzed. Default is false (skip already-processed crashes).")
    }),
    outputSchema: z2.object({
      export_result: z2.any(),
      symbolication_result: z2.any(),
      analysis_report: z2.any()
    })
  },
  async (input) => {
    const config = getConfig();
    const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
    const basicDir = getXcodeCrashesDir(config);
    const symbolicatedDir = getSymbolicatedDir(config);
    const dsymPath = config.DSYM_PATH;
    const versions = input.versions?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
    const includeProcessed = input.includeProcessedCrashes === true;
    const offset = parseInt(config.CRASH_DATE_OFFSET ?? "4", 10);
    const numDays = input.numDays ?? parseInt(config.CRASH_NUM_DAYS ?? "1", 10);
    const { startDateISO, endDateISO } = computeDateRange(numDays, offset);
    const rangeKey = `${startDateISO}..${endDateISO}`;
    if (!includeProcessed) {
      const fastPathManifest = new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
      if (fastPathManifest.isRangeCovered(startDateISO, endDateISO)) {
        const skippedResult = {
          export_result: { skipped: true, reason: `Range ${rangeKey} already fully processed` },
          symbolication_result: { skipped: true, reason: `Range ${rangeKey} already fully processed` },
          analysis_report: { skipped: true, reason: `Range ${rangeKey} already fully processed` }
        };
        return {
          content: [{ type: "text", text: JSON.stringify(skippedResult, null, 2) }],
          structuredContent: skippedResult
        };
      }
    }
    const exportManifest = includeProcessed ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
    const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false, startDateISO, endDateISO, exportManifest);
    const exportedPaths = exportResult.files.filter((f) => !f.skipped).map((f) => f.destination);
    let symbolicationResult = { skipped: true, reason: "DSYM_PATH not configured" };
    let symbolicatedPaths = [];
    if (dsymPath) {
      if (exportedPaths.length === 0) {
        symbolicationResult = { skipped: true, reason: "No new files were exported for this date range" };
      } else {
        const symbolicateManifest = includeProcessed ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "symbolicate");
        const batchRes = await symbolicateFiles(exportedPaths, dsymPath, symbolicatedDir, symbolicateManifest);
        symbolicationResult = batchRes;
        symbolicatedPaths = batchRes.results.filter((r) => r.success).map((r) => path12.join(symbolicatedDir, r.file));
      }
    }
    const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
    const analyzeManifest = includeProcessed ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "analyze");
    const analysisReport = analyzeFiles(symbolicatedPaths, fixStatuses, analyzeManifest);
    const reportsDir = getAnalyzedReportsDir(config);
    const ts = Date.now();
    const reportFile = path12.join(reportsDir, `jsonReport_${ts}.json`);
    const csvFile = path12.join(reportsDir, `sheetReport_${ts}.csv`);
    try {
      fs10.mkdirSync(reportsDir, { recursive: true });
      fs10.writeFileSync(reportFile, JSON.stringify(analysisReport, null, 2), "utf-8");
      exportReportToCsv(analysisReport, csvFile);
      const latestJsonPath = path12.join(reportsDir, "latest.json");
      const latestCsvPath = path12.join(reportsDir, "latest.csv");
      fs10.copyFileSync(reportFile, latestJsonPath);
      fs10.copyFileSync(csvFile, latestCsvPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Warning: failed to save report to ${reportFile}: ${msg}`);
    }
    const pipelineManifest = new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
    const resolvedCrashIds = exportedPaths.map((p) => extractIncidentId(p) ?? path12.basename(p));
    pipelineManifest.recordPipelineRun(rangeKey, {
      startDate: startDateISO,
      endDate: endDateISO,
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      crashIds: resolvedCrashIds,
      exportedCount: exportedPaths.length,
      symbolicatedCount: symbolicatedPaths.length,
      analyzedCount: analysisReport.total_crashes,
      reportPath: reportFile
    });
    const result = {
      export_result: exportResult,
      symbolication_result: symbolicationResult,
      analysis_report: analysisReport
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);
server.registerTool(
  "clean_old_crashes",
  {
    description: "Delete .crash and .ips files older than a given date from MainCrashLogsFolder (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs) and SymbolicatedCrashLogsFolder. Crash date is read from the file header (Date/Time field); falls back to filesystem modification time if not found. Use dryRun to preview what would be deleted.",
    inputSchema: z2.object({
      beforeDate: z2.string().describe("ISO date string \u2014 files with crash dates before this date will be deleted (e.g. 2026-03-01)"),
      dryRun: z2.boolean().optional().describe("When true, reports what would be deleted without actually deleting (default: false)")
    }),
    outputSchema: z2.object({
      deleted: z2.number(),
      skipped: z2.number(),
      totalScanned: z2.number(),
      files: z2.array(
        z2.object({
          file: z2.string(),
          crashDate: z2.string(),
          deleted: z2.boolean()
        })
      )
    })
  },
  async (input) => {
    const config = getConfig();
    const dryRun = input.dryRun ?? false;
    try {
      validateDateInput(input.beforeDate, "beforeDate");
    } catch (err) {
      return { content: [{ type: "text", text: err.message }] };
    }
    const dirs = [
      getXcodeCrashesDir(config),
      getAppticsCrashesDir(config),
      getOtherCrashesDir(config),
      getSymbolicatedDir(config)
    ];
    const result = cleanOldCrashes(input.beforeDate, dirs, dryRun, config.CRASH_ANALYSIS_PARENT, dryRun ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export"));
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);
server.registerTool(
  "cleanup_reports",
  {
    description: "Delete analyzed report files (.json and .csv) in AnalyzedReportsFolder that are older than a given date. Targets timestamped report files generated by the analysis pipeline (jsonReport_<timestamp>.json, sheetReport_<timestamp>.csv). Stable pointer files (latest.json, latest.csv) are never deleted. Use dryRun to preview what would be deleted.",
    inputSchema: z2.object({
      beforeDate: z2.string().describe("ISO date string \u2014 analyzed report files with a report date before this date will be deleted (e.g. 2026-03-01)"),
      dryRun: z2.boolean().optional().describe("When true, reports what would be deleted without actually deleting (default: false)")
    }),
    outputSchema: z2.object({
      deleted: z2.number(),
      skipped: z2.number(),
      totalScanned: z2.number(),
      files: z2.array(
        z2.object({
          file: z2.string(),
          reportDate: z2.string(),
          deleted: z2.boolean()
        })
      )
    })
  },
  async (input) => {
    const config = getConfig();
    const dryRun = input.dryRun ?? false;
    try {
      validateDateInput(input.beforeDate, "beforeDate");
    } catch (err) {
      return { content: [{ type: "text", text: err.message }] };
    }
    const reportsDir = getAnalyzedReportsDir(config);
    const result = cleanOldReports(input.beforeDate, reportsDir, dryRun);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result
    };
  }
);
var transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();
