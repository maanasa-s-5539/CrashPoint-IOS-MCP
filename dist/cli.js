#!/usr/bin/env node
import { fileURLToPath as _fUTP } from 'url'; import { dirname as _dn } from 'path'; const __dirname = _dn(_fUTP(import.meta.url)); const __filename = _fUTP(import.meta.url);

// src/cli/parseFlags.ts
function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

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

// src/cli/cmdExport.ts
async function cmdExport(flags) {
  const config = getConfig();
  const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const outputDir = getXcodeCrashesDir(config);
  const versions = config.CRASH_VERSIONS?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  const numDaysRaw = flags["num-days"];
  const offset = parseInt(config.CRASH_DATE_OFFSET ?? "4", 10);
  const numDays = numDaysRaw ? parseInt(numDaysRaw, 10) : parseInt(config.CRASH_NUM_DAYS ?? "1", 10);
  const { startDateISO, endDateISO } = computeDateRange(numDays, offset);
  const dryRun = flags["dry-run"] === true;
  const includeProcessed = flags["include-processed"] === true;
  const manifest = dryRun || includeProcessed ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
  const result = exportCrashLogs(inputDir, outputDir, versions, false, dryRun, startDateISO, endDateISO, manifest);
  console.log(JSON.stringify(result, null, 2));
}

// src/cli/cmdBatch.ts
import path6 from "path";

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

// src/pathSafety.ts
import path5 from "path";
function assertPathUnderBase(userPath, base) {
  const resolved = path5.resolve(userPath);
  const resolvedBase = path5.resolve(base);
  if (!resolved.startsWith(resolvedBase + path5.sep) && resolved !== resolvedBase) {
    throw new Error(`Path "${userPath}" is outside the allowed directory "${base}"`);
  }
  return resolved;
}
function assertNoTraversal(userPath) {
  if (userPath.includes("..")) {
    throw new Error(`Path "${userPath}" contains directory traversal`);
  }
  return path5.resolve(userPath);
}
var BLOCKED_PREFIXES = ["/etc", "/var/run", "/usr/bin", "/usr/sbin", "/System", "/Library/LaunchDaemons"];
function assertSafeSymlinkTarget(target) {
  const resolved = path5.resolve(target);
  for (const prefix of BLOCKED_PREFIXES) {
    if (resolved.startsWith(prefix + "/") || resolved === prefix) {
      throw new Error(`Symlink target "${target}" points to a restricted system directory`);
    }
  }
}

// src/cli/cmdBatch.ts
async function cmdBatch(flags) {
  const config = getConfig();
  const outputDir = getSymbolicatedDir(config);
  const dsymPath = config.DSYM_PATH;
  const includeProcessed = flags["include-processed"] === true;
  const manifest = includeProcessed ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "symbolicate");
  const filePath = flags["file"];
  if (!dsymPath) {
    console.error("Error: DSYM_PATH env var is required for batch symbolication.");
    process.exit(1);
  }
  if (filePath) {
    assertNoTraversal(filePath);
    const outputPath = path6.join(outputDir, path6.basename(filePath));
    const result = await symbolicateOne(filePath, dsymPath, outputPath);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const crashDir = getXcodeCrashesDir(config);
  const appticsDir = getAppticsCrashesDir(config);
  const otherDir = getOtherCrashesDir(config);
  if (!hasCrashFiles(crashDir) && !hasCrashFiles(appticsDir) && !hasCrashFiles(otherDir)) {
    console.log(
      JSON.stringify({
        succeeded: 0,
        failed: 0,
        total: 0,
        results: [],
        message: "No .crash or .ips files found in MainCrashLogsFolder/XCodeCrashLogs, MainCrashLogsFolder/AppticsCrashLogs, or MainCrashLogsFolder/OtherCrashLogs"
      }, null, 2)
    );
    return;
  }
  let succeeded = 0;
  let failed = 0;
  let total = 0;
  const results = [];
  for (const dir of [crashDir, appticsDir, otherDir]) {
    const r = await runBatch(dir, dsymPath, outputDir, manifest);
    succeeded += r.succeeded;
    failed += r.failed;
    total += r.total;
    results.push(...r.results);
  }
  console.log(JSON.stringify({ succeeded, failed, total, results }, null, 2));
}

// src/cli/cmdAnalyze.ts
import fs8 from "fs";
import path10 from "path";

// src/core/crashAnalyzer.ts
import fs5 from "fs";
import path7 from "path";
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
    const filepath = path7.join(crashDir, file);
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
    const fs13 = fixStatuses?.[g.signature];
    return {
      ...g,
      rank: idx + 1,
      fix_status: fs13 ? { fixed: fs13.fixed, note: fs13.note } : void 0
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
    group.affected_files.push(path7.basename(filepath));
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
    source_dir: files.length > 0 ? path7.dirname(files[0]) : "multiple sources",
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
      const filepath = path7.join(dir, file);
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

// src/core/csvExporter.ts
import fs6 from "fs";
import path8 from "path";
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
    const dir = path8.dirname(outputPath);
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

// src/state/fixTracker.ts
import fs7 from "fs";
import path9 from "path";
var FixTracker = class {
  constructor(parentDir) {
    this.filePath = path9.join(parentDir, "StateMaintenance", "fix_status.json");
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
    fs7.mkdirSync(path9.dirname(this.filePath), { recursive: true });
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

// src/cli/cmdAnalyze.ts
async function cmdAnalyze(flags) {
  const config = getConfig();
  const crashDir = getSymbolicatedDir(config);
  const includeProcessed = flags["include-processed"] === true;
  const manifest = includeProcessed ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "analyze");
  const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
  const report = analyzeDirectory(crashDir, fixStatuses, manifest);
  const json = JSON.stringify(report, null, 2);
  console.log(json);
  const reportsDir = getAnalyzedReportsDir(config);
  fs8.mkdirSync(reportsDir, { recursive: true });
  const ts = Date.now();
  const jsonFile = path10.join(reportsDir, `jsonReport_${ts}.json`);
  const csvFile = path10.join(reportsDir, `sheetReport_${ts}.csv`);
  fs8.writeFileSync(jsonFile, json, "utf-8");
  console.log(`JSON report written to ${jsonFile}`);
  const csvResult = exportReportToCsv(report, csvFile);
  if (csvResult.success) {
    console.log(`CSV report written to ${csvFile} (${csvResult.totalRows} row(s))`);
  } else {
    console.error(`CSV export failed: ${csvResult.message}`);
  }
  const latestJsonPath = path10.join(reportsDir, "latest.json");
  const latestCsvPath = path10.join(reportsDir, "latest.csv");
  fs8.copyFileSync(jsonFile, latestJsonPath);
  fs8.copyFileSync(csvFile, latestCsvPath);
}

// src/core/setup.ts
import fs9 from "fs";
import os2 from "os";
import path12 from "path";

// src/core/automationTemplates.ts
import os from "os";
import path11 from "path";
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
  const scriptPath = path11.join(config.CRASH_ANALYSIS_PARENT, "Automation", "run_crash_pipeline.sh");
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
SCHEDULED_RUN_TIME=$(node -e "console.log(require(process.argv[1]).SCHEDULED_RUN_TIME || '11:00')" "$CONFIG_JSON")
IFS=':' read -r SCHED_HOUR SCHED_MINUTE <<< "$SCHEDULED_RUN_TIME"
SCHED_HOUR=$((10#\${SCHED_HOUR:-11}))
SCHED_MINUTE=$((10#\${SCHED_MINUTE:-0}))
if [ "$SCHED_HOUR" -lt 0 ] || [ "$SCHED_HOUR" -gt 23 ] || [ "$SCHED_MINUTE" -lt 0 ] || [ "$SCHED_MINUTE" -gt 59 ]; then
  echo "WARNING: SCHEDULED_RUN_TIME '$SCHEDULED_RUN_TIME' is invalid, defaulting to 11:00"
  SCHED_HOUR=11
  SCHED_MINUTE=0
fi

if [ -z "$APP_DISPLAY_NAME" ]; then
  echo "ERROR: APP_DISPLAY_NAME not set in $CONFIG_JSON"; exit 1
fi

# \u2500\u2500\u2500 CLAUDE CLI PATH \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
CLAUDE_PATH=$(node -e "console.log(require(process.argv[1]).CLAUDE_CLI_PATH || '')" "$CONFIG_JSON")
if [ -z "$CLAUDE_PATH" ]; then
  echo "ERROR: CLAUDE_CLI_PATH not set in $CONFIG_JSON"
  exit 1
fi

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

# \u2500\u2500\u2500 PRE-STEP: Generate .mcp.json if not already present \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
MCP_JSON_FILE="$PARENT_HOLDER_FOLDER/.mcp.json"
if [ ! -f "$MCP_JSON_FILE" ]; then
  echo "Generating $MCP_JSON_FILE from $CONFIG_JSON..."
  _DSYM_PATH=$(node -e "console.log(require(process.argv[1]).DSYM_PATH || '')" "$CONFIG_JSON")
  _APP_PATH=$(node -e "console.log(require(process.argv[1]).APP_PATH || '')" "$CONFIG_JSON")
  _APP_NAME=$(node -e "console.log(require(process.argv[1]).APP_NAME || '')" "$CONFIG_JSON")
  _MASTER_BRANCH=$(node -e "console.log(require(process.argv[1]).MASTER_BRANCH_PATH || '')" "$CONFIG_JSON")
  _DEV_BRANCH=$(node -e "console.log(require(process.argv[1]).DEV_BRANCH_PATH || '')" "$CONFIG_JSON")
  _CLIQ_URL=$(node -e "console.log(require(process.argv[1]).ZOHO_CLIQ_WEBHOOK_URL || '')" "$CONFIG_JSON")
  _PORTAL_ID=$(node -e "console.log(require(process.argv[1]).ZOHO_PROJECTS_PORTAL_ID || '')" "$CONFIG_JSON")
  _PROJECT_ID=$(node -e "console.log(require(process.argv[1]).ZOHO_PROJECTS_PROJECT_ID || '')" "$CONFIG_JSON")
  _STATUS_ID=$(node -e "console.log(require(process.argv[1]).ZOHO_BUG_STATUS_OPEN || '')" "$CONFIG_JSON")
  _APP_VER_FIELD=$(node -e "console.log(require(process.argv[1]).ZOHO_BUG_APP_VERSION || '')" "$CONFIG_JSON")
  _OCC_FIELD=$(node -e "console.log(require(process.argv[1]).ZOHO_BUG_NUM_OF_OCCURRENCES || '')" "$CONFIG_JSON")
  _CRASH_VERSIONS=$(node -e "console.log(require(process.argv[1]).CRASH_VERSIONS || '')" "$CONFIG_JSON")
  cat > "$MCP_JSON_FILE" << MCP_JSON_EOF
{
  "mcpServers": {
    "crashpoint-ios": {
      "command": "npx",
      "args": ["-p", "github:maanasa-s-5539/CrashPoint-IOS-MCP", "crashpoint-ios-core"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "$PARENT_HOLDER_FOLDER",
        "DSYM_PATH": "$_DSYM_PATH",
        "APP_PATH": "$_APP_PATH",
        "APP_NAME": "$_APP_NAME",
        "MASTER_BRANCH_PATH": "$_MASTER_BRANCH",
        "DEV_BRANCH_PATH": "$_DEV_BRANCH"
      }
    },
    "crashpoint-integrations": {
      "command": "npx",
      "args": ["-p", "github:maanasa-s-5539/CrashPoint-Integrations-MCP", "crashpoint-integrations"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "$PARENT_HOLDER_FOLDER",
        "ZOHO_CLIQ_WEBHOOK_URL": "$_CLIQ_URL",
        "ZOHO_PROJECTS_PORTAL_ID": "$_PORTAL_ID",
        "ZOHO_PROJECTS_PROJECT_ID": "$_PROJECT_ID",
        "ZOHO_BUG_STATUS_OPEN": "$_STATUS_ID",
        "ZOHO_BUG_APP_VERSION": "$_APP_VER_FIELD",
        "ZOHO_BUG_NUM_OF_OCCURRENCES": "$_OCC_FIELD",
        "CRASH_VERSIONS": "$_CRASH_VERSIONS"
      }
    }
  }
}
MCP_JSON_EOF
  echo "Generated $MCP_JSON_FILE"
fi

# \u2500\u2500\u2500 PRE-STEP: Generate launchd plist if not already present \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
PLIST_FILE="$HOME/Library/LaunchAgents/com.crashpipeline.daily_mcp.plist"
if [ ! -f "$PLIST_FILE" ]; then
  echo "Generating $PLIST_FILE..."
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST_FILE" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.crashpipeline.daily_mcp</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$SCRIPT_DIR/run_crash_pipeline.sh</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>$SCHED_HOUR</integer>
        <key>Minute</key>
        <integer>$SCHED_MINUTE</integer>
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
        <string>$HOME</string>
    </dict>
</dict>
</plist>
PLIST_EOF
  launchctl load "$PLIST_FILE" 2>/dev/null || true
  echo "Generated and loaded $PLIST_FILE"
fi

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

# \u2500\u2500\u2500 SUBSTITUTE PLACEHOLDERS FROM config file \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
if [ -n "\${APPTICS_MCP_NAME}" ]; then
  PROMPT=$(sed \\
    -e "s|{{APPTICS_MCP_NAME}}|\${APPTICS_MCP_NAME}|g" \\
    "$PROMPT_FILE")
else
  PROMPT=$(sed \\
    -e '/{{APPTICS_MCP_NAME}}/d' \\
    "$PROMPT_FILE")
fi

# \u2500\u2500\u2500 BUILD --allowedTools DYNAMICALLY FROM config file MCP NAMES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
ALLOWED_TOOLS="mcp__crashpoint-ios__*,mcp__crashpoint-integrations__*"
if [ -n "\${APPTICS_MCP_NAME}" ]; then
  ALLOWED_TOOLS="\${ALLOWED_TOOLS},mcp__\${APPTICS_MCP_NAME}__*"
fi

# \u2500\u2500\u2500 TIMESTAMP & LOG FILE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="$LOG_DIR/pipeline_\${TIMESTAMP}.log"

{
  echo "=== Crash Pipeline Run: $TIMESTAMP ==="
  echo "App:           \${APP_DISPLAY_NAME}"
  if [ -n "\${APPTICS_MCP_NAME}" ]; then
    echo "Apptics MCP:   \${APPTICS_MCP_NAME} (used for Zoho Projects bug tools)"
  fi
  echo "Allowed Tools: \${ALLOWED_TOOLS}"
  echo "---"
} | tee "$LOG_FILE"

# \u2500\u2500\u2500 cd INTO ParentHolderFolder (so Claude picks up .mcp.json) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
cd "$PARENT_HOLDER_FOLDER"

# \u2500\u2500\u2500 RUN PIPELINE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
"$CLAUDE_PATH" -p "$PROMPT" \\
  --allowedTools "$ALLOWED_TOOLS" \\
  --max-turns 70 \\
  2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=\${PIPESTATUS[0]}

if [ "$EXIT_CODE" -ne 0 ]; then
  echo "ERROR: Pipeline failed with exit code $EXIT_CODE" | tee -a "$LOG_FILE"
fi

echo "=== Pipeline Complete ===" | tee -a "$LOG_FILE"
exit "$EXIT_CODE"
`;
var DAILY_CRASH_PIPELINE_PROMPT_MD = `You are running an automated daily crash analysis pipeline. Execute these steps in order, stopping if any step fails:

## Step 1: Run Full Pipeline (Download + Export + Symbolicate + Analyze)
Use the crashpoint-integrations MCP server. Call run_full_pipeline with notifyCliq=true and reportToProjects=true. This will download crashes from Apptics, export, symbolicate, and analyze them. The download uses the configured Apptics API credentials. Dates are computed automatically from CRASH_DATE_OFFSET.

## Step 2: Notify Cliq
If the pipeline result shows crash groups were found (check analyze.crashGroups > 0), use the crashpoint-integrations MCP server to call notify_cliq with the report path from the pipeline result.

## Step 3: Create/Update Bugs in Zoho Projects
If the pipeline result has nextSteps.reportToProjects=true, use the crashpoint-integrations MCP server to call prepare_project_bugs to get structured bug data. Then use the {{APPTICS_MCP_NAME}} MCP server's Zoho Projects tools (list_bugs, create_bug, update_bug) with the portal_id, project_id, and field values from the prepare_project_bugs output.
If an issue with the same crash signature and app version number does not exist already, create a new issue, setting the App Version and Number of Occurrences field values.
If an issue with the same crash signature exists already, update the existing crash's number of occurrences. Take the existing value in the number of occurrences field, add the new number of occurrences from the report, and set the updated total.

## Step 4: Analyze Fix Status and Create Fix Plan

If the pipeline result shows crash groups were found (crashGroups > 0):

1. Read the crash analysis report from the reportPath in the pipeline result. For each crash group, extract the **exception type**, **signature**, and **top frames** (these are symbolicated with file and function names).

2. For each crash group, examine the source file(s) referenced in the top frames:
   - Read the relevant source files from the **Master/Live branch** path (configured as MASTER_BRANCH_PATH in crashpoint.config.json) to understand the crash-causing code.
   - Read the same source files from the **Development branch** path (configured as DEV_BRANCH_PATH in crashpoint.config.json) to check whether the crash site has been modified or fixed.

3. Check if a 'LatestFixPlan.md' exists in the Automation/FixPlans/ folder.

4. If this exists, verify if the existing crash signature has already been analyzed, if yes, increase the crash occurrence count only.

5. If the file doesn't exist, create a plan 'LatestFixPlan.md' in the Automation/FixPlans/ folder.

6. For each crash, determine:
   - **Possible Cause**: Based on the exception type, stack trace, and the source code at that location in the Master branch, describe the likely root cause.
   - **Fix Status**: Compare the Master and Dev branch versions of the file. If the code at or around the crash site has been changed in Dev, describe what was changed and whether it appears to address the crash. If unchanged, mark it as "Not yet fixed in Development".
   - **Suggested Fix**: If no fix exists in Dev, suggest a concrete fix approach.

7. Write the results to \`Automation/FixPlans/LatestFixPlan.md\` inside the ParentHolderFolder with the following structure:

# Crash Fix Plan \u2014 {date}

## Summary
- Total crash groups analyzed: {count}
- Fixed in Development: {count}
- Not yet fixed: {count}

## Crash Groups

### 1. {Exception Type} \u2014 {Signature snippet}
- **Occurrences:** {count}
- **Top Frames:** {list the top symbolicated frames}
- **Possible Cause:** {analysis of why this crash occurs}
- **Status in Development Branch:** Fixed / Not Fixed
- **Changes in Dev:** {description of relevant changes, or "No changes detected"}
- **Suggested Fix:** {if not fixed, describe the recommended approach}

### 2. ...

After completing all steps, output a summary of what was processed.
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
    getAutomationDir(config),
    path12.join(getAutomationDir(config), "FixPlans")
  ];
  for (const dir of dirsToCreate) {
    if (!fs9.existsSync(dir)) {
      fs9.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }
  const automationDir = getAutomationDir(config);
  const scaffoldedFiles = [];
  const templates = getAutomationTemplates(parentDir);
  for (const { filename, content, executable } of templates) {
    const destPath = path12.join(automationDir, filename);
    if (!fs9.existsSync(destPath)) {
      fs9.writeFileSync(destPath, content, "utf-8");
      if (executable) {
        fs9.chmodSync(destPath, 493);
      }
      scaffoldedFiles.push(destPath);
    }
  }
  const configJsonPath = path12.join(parentDir, "crashpoint.config.json");
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
  const mcpJsonPath = path12.join(parentDir, ".mcp.json");
  if (!fs9.existsSync(mcpJsonPath)) {
    fs9.writeFileSync(mcpJsonPath, generateMcpJson(fullConfig), "utf-8");
    scaffoldedFiles.push(mcpJsonPath);
  }
  const launchAgentsDir = path12.join(os2.homedir(), "Library", "LaunchAgents");
  const plistPath = path12.join(launchAgentsDir, "com.crashpipeline.daily_mcp.plist");
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
    const resolvedTarget = path12.resolve(target);
    const linkPath = path12.join(parentDir, name);
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
      if (lowerTarget.endsWith(".dsym") || lowerTarget.endsWith(".app") || lowerTarget.endsWith(".framework") || !path12.extname(resolvedTarget)) {
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

// src/cli/cmdSetup.ts
function cmdSetup(flags) {
  const result = setupWorkspace({
    masterBranchPath: flags["master-branch"],
    devBranchPath: flags["dev-branch"],
    dsymPath: flags["dsym"],
    appPath: flags["app"]
  });
  console.log(JSON.stringify(result, null, 2));
}

// src/cli/cmdPipeline.ts
import fs10 from "fs";
import path13 from "path";
async function cmdPipeline(flags) {
  const config = getConfig();
  const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const basicDir = getXcodeCrashesDir(config);
  const symbolicatedDir = getSymbolicatedDir(config);
  const dsymPath = config.DSYM_PATH;
  const includeProcessed = flags["include-processed"] === true;
  const versions = flags["versions"] ? flags["versions"].split(",").map((v) => v.trim()).filter(Boolean) : config.CRASH_VERSIONS?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  const numDaysRaw = flags["num-days"];
  const offset = parseInt(config.CRASH_DATE_OFFSET ?? "4", 10);
  const numDays = numDaysRaw ? parseInt(numDaysRaw, 10) : parseInt(config.CRASH_NUM_DAYS ?? "1", 10);
  const { startDateISO: startDate, endDateISO: endDate } = computeDateRange(numDays, offset);
  const rangeKey = `${startDate}..${endDate}`;
  if (!includeProcessed) {
    const fastPathManifest = new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
    if (fastPathManifest.isRangeCovered(startDate, endDate)) {
      console.log(`
Pipeline skipped: Range ${rangeKey} already fully processed.`);
      return;
    }
  }
  const exportManifest = includeProcessed ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
  const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false, startDate, endDate, exportManifest);
  console.log("\n\u2500\u2500 Export \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(JSON.stringify(exportResult, null, 2));
  const exportedPaths = exportResult.files.filter((f) => !f.skipped).map((f) => f.destination);
  let symbolicationResult = null;
  let symbolicatedPaths = [];
  console.log("\n\u2500\u2500 Symbolication \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  if (dsymPath) {
    if (exportedPaths.length === 0) {
      symbolicationResult = { skipped: true, reason: "No new files were exported for this date range" };
    } else {
      const symbolicateManifest = includeProcessed ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "symbolicate");
      const batchRes = await symbolicateFiles(exportedPaths, dsymPath, symbolicatedDir, symbolicateManifest);
      symbolicationResult = batchRes;
      symbolicatedPaths = batchRes.results.filter((r) => r.success).map((r) => path13.join(symbolicatedDir, r.file));
    }
    console.log(JSON.stringify(symbolicationResult, null, 2));
  } else {
    symbolicationResult = { skipped: true, reason: "DSYM_PATH not set" };
    console.log(JSON.stringify(symbolicationResult, null, 2));
  }
  const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
  const analyzeManifest = includeProcessed ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "analyze");
  const report = analyzeFiles(symbolicatedPaths, fixStatuses, analyzeManifest);
  const reportsDir = getAnalyzedReportsDir(config);
  fs10.mkdirSync(reportsDir, { recursive: true });
  const ts = Date.now();
  const reportFile = path13.join(reportsDir, `jsonReport_${ts}.json`);
  const csvFile = path13.join(reportsDir, `sheetReport_${ts}.csv`);
  fs10.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf-8");
  exportReportToCsv(report, csvFile);
  const latestJsonPath = path13.join(reportsDir, "latest.json");
  const latestCsvPath = path13.join(reportsDir, "latest.csv");
  fs10.copyFileSync(reportFile, latestJsonPath);
  fs10.copyFileSync(csvFile, latestCsvPath);
  console.log("\n\u2500\u2500 Analysis \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(JSON.stringify(report, null, 2));
  console.log(`JSON report saved to: ${reportFile}`);
  console.log(`CSV report saved to: ${csvFile}`);
  const pipelineManifest = new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
  const resolvedCrashIds = exportedPaths.map((p) => extractIncidentId(p) ?? path13.basename(p));
  pipelineManifest.recordPipelineRun(rangeKey, {
    startDate,
    endDate,
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    crashIds: resolvedCrashIds,
    exportedCount: exportedPaths.length,
    symbolicatedCount: symbolicatedPaths.length,
    analyzedCount: report.total_crashes,
    reportPath: reportFile
  });
}

// src/cli/cmdClean.ts
function cmdClean(flags) {
  const beforeDate = flags["before-date"];
  if (!beforeDate) {
    console.error("Error: --before-date <ISO date> is required for clean command.");
    process.exit(1);
  }
  try {
    validateDateInput(beforeDate, "--before-date");
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  const dryRun = flags["dry-run"] === true;
  const config = getConfig();
  const dirs = [
    getXcodeCrashesDir(config),
    getAppticsCrashesDir(config),
    getOtherCrashesDir(config),
    getSymbolicatedDir(config)
  ];
  const manifest = dryRun ? void 0 : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
  const result = cleanOldCrashes(beforeDate, dirs, dryRun, config.CRASH_ANALYSIS_PARENT, manifest);
  console.log(JSON.stringify(result, null, 2));
  if (dryRun) {
    console.log(`Dry-run: ${result.deleted} file(s) would be deleted, ${result.skipped} skipped.`);
  } else {
    console.log(`Deleted ${result.deleted} file(s), skipped ${result.skipped}.`);
  }
}

// src/core/reportCleaner.ts
import fs11 from "fs";
import path14 from "path";
function getReportDate(filename, filepath) {
  const match = /^(?:jsonReport|sheetReport)_(\d+)\.(json|csv)$/.exec(filename);
  if (match) {
    const ms = parseInt(match[1], 10);
    if (!isNaN(ms)) return new Date(ms);
  }
  return fs11.statSync(filepath).mtime;
}
function cleanOldReports(beforeDate, reportsDir, dryRun = false) {
  const before = validateDateInput(beforeDate, "--before-date");
  const files = [];
  let deleted = 0;
  let skipped = 0;
  let totalScanned = 0;
  if (!fs11.existsSync(reportsDir)) {
    return { deleted, skipped, totalScanned, files };
  }
  const allFiles = fs11.readdirSync(reportsDir).filter((f) => {
    if (f === "latest.json" || f === "latest.csv") return false;
    return f.endsWith(".json") || f.endsWith(".csv");
  });
  for (const filename of allFiles) {
    const filepath = path14.join(reportsDir, filename);
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
          fs11.unlinkSync(filepath);
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

// src/cli/cmdCleanReports.ts
function cmdCleanReports(flags) {
  const beforeDate = flags["before-date"];
  if (!beforeDate) {
    console.error("Error: --before-date <ISO date> is required for cleanup-reports command.");
    process.exit(1);
  }
  try {
    validateDateInput(beforeDate, "--before-date");
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  const dryRun = flags["dry-run"] === true;
  const config = getConfig();
  const reportsDir = getAnalyzedReportsDir(config);
  const result = cleanOldReports(beforeDate, reportsDir, dryRun);
  console.log(JSON.stringify(result, null, 2));
  if (dryRun) {
    console.log(`Dry-run: ${result.deleted} report file(s) would be deleted, ${result.skipped} skipped.`);
  } else {
    console.log(`Deleted ${result.deleted} report file(s), skipped ${result.skipped}.`);
  }
}

// src/cli/cmdVerifyDsym.ts
import fs12 from "fs";
import path15 from "path";
import { execFile as execFile2 } from "child_process";
import { promisify as promisify2 } from "util";
var execFileAsync2 = promisify2(execFile2);
async function cmdVerifyDsym(flags) {
  const config = getConfig();
  const flagDsym = flags["dsym"];
  const crashPath = flags["crash"];
  const crashDir = flags["crash-dir"];
  const hasDsymFlag = Boolean(flagDsym);
  const hasCrashFlag = Boolean(crashPath || crashDir);
  if (hasDsymFlag && !hasCrashFlag) {
    console.error("Error: --dsym requires --crash or --crash-dir to also be provided. Either supply both or neither.");
    process.exit(1);
  }
  if (!hasDsymFlag && hasCrashFlag) {
    console.error("Error: --crash/--crash-dir requires --dsym to also be provided. Either supply both or neither.");
    process.exit(1);
  }
  let dsymPath;
  if (flagDsym) {
    dsymPath = flagDsym;
  } else if (config.DSYM_PATH) {
    dsymPath = config.DSYM_PATH;
  } else {
    const symlinkPath = path15.join(config.CRASH_ANALYSIS_PARENT, "dSYM_File");
    try {
      dsymPath = fs12.realpathSync(symlinkPath);
    } catch {
      console.error("Error: No dSYM path available. Provide --dsym, set DSYM_PATH env var, or run setup to create the dSYM_File symlink in CRASH_ANALYSIS_PARENT.");
      process.exit(1);
    }
  }
  assertNoTraversal(dsymPath);
  if (!fs12.existsSync(dsymPath)) {
    console.error(`Error: dSYM not found at: ${dsymPath}`);
    process.exit(1);
  }
  let resolvedDsymPath;
  try {
    resolvedDsymPath = fs12.realpathSync(dsymPath);
  } catch {
    resolvedDsymPath = dsymPath;
  }
  let dwarfOutput = "";
  try {
    const { stdout } = await execFileAsync2("dwarfdump", ["--uuid", resolvedDsymPath]);
    dwarfOutput = stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: dwarfdump failed: ${msg}`);
    process.exit(1);
  }
  const uuidLineRe = /UUID:\s+([0-9A-F-]+)\s+\(([^)]+)\)/gi;
  const dsymUuids = [];
  let match;
  while ((match = uuidLineRe.exec(dwarfOutput)) !== null) {
    dsymUuids.push({ uuid: match[1].toUpperCase(), arch: match[2] });
  }
  const crashFiles = [];
  if (hasCrashFlag) {
    if (crashPath) {
      assertNoTraversal(crashPath);
      assertPathUnderBase(crashPath, getMainCrashLogsDir(config));
      crashFiles.push(crashPath);
    }
    if (crashDir) {
      assertPathUnderBase(crashDir, getMainCrashLogsDir(config));
      if (fs12.existsSync(crashDir)) {
        fs12.readdirSync(crashDir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips")).forEach((f) => crashFiles.push(path15.join(crashDir, f)));
      }
    }
  } else {
    const dirs = [
      getXcodeCrashesDir(config),
      getAppticsCrashesDir(config),
      getOtherCrashesDir(config)
    ];
    for (const dir of dirs) {
      if (fs12.existsSync(dir)) {
        fs12.readdirSync(dir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips")).forEach((f) => crashFiles.push(path15.join(dir, f)));
      }
    }
  }
  if (crashFiles.length === 0) {
    console.log(JSON.stringify({ valid: true, dsymPath, dsymUuids, detail: `dSYM is valid. Found ${dsymUuids.length} UUID(s). No crash files found for UUID comparison.` }, null, 2));
    return;
  }
  const binaryImgRe = /^\s*0x[0-9a-fA-F]+\s+-\s+0x[0-9a-fA-F]+\s+(\S+)\s+\S+\s+<([0-9a-f]{32})>/gim;
  const appName = config.APP_NAME;
  const crashFileUuids = [];
  for (const cf of crashFiles) {
    let content = "";
    try {
      content = fs12.readFileSync(cf, "utf-8");
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
        crashFileUuids.push({ file: path15.basename(cf), uuid });
      }
    }
  }
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
  const dsymUuidSet = new Set(dsymUuids.map((u) => u.uuid));
  for (const { uuid, file } of crashFileUuids) {
    if (!dsymUuidSet.has(uuid)) {
      mismatches.push(`Crash file ${file} UUID ${uuid} not found in dSYM`);
    }
  }
  const valid = matches.length > 0 && mismatches.length === 0;
  const detail = matches.length > 0 ? `${matches.length} UUID match(es) found. ${mismatches.length > 0 ? `${mismatches.length} mismatch(es).` : "All UUIDs matched."}` : `No UUID matches found. Symbolication will likely fail \u2014 ensure the correct dSYM for this build is used.`;
  console.log(JSON.stringify({ valid, dsymPath, dsymUuids, crashFileUuids, matches, mismatches, detail }, null, 2));
}

// src/cli/cmdFixStatus.ts
function cmdFixStatus(flags) {
  const action = flags["action"];
  const signature = flags["signature"];
  const note = flags["note"];
  if (!action || !["set", "unset", "list"].includes(action)) {
    console.error("Error: --action <set|unset|list> is required for fix-status command.");
    process.exit(1);
  }
  const config = getConfig();
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  if (action === "list") {
    console.log(JSON.stringify(tracker.getAll(), null, 2));
    return;
  }
  if (!signature) {
    console.error(`Error: --signature <sig> is required for action "${action}".`);
    process.exit(1);
  }
  if (action === "set") {
    const fixed = flags["fixed"] ?? true;
    tracker.setFixed(signature, fixed, note);
    console.log(`Marked as ${fixed ? "fixed" : "unfixed"}: ${signature}${note ? ` (note: ${note})` : ""}`);
  } else {
    tracker.setFixed(signature, false);
    console.log(`Marked as unfixed: ${signature}`);
  }
}

// src/cli/index.ts
var [, , command, ...args] = process.argv;
function printUsage() {
  console.log(`
CrashPoint iOS CLI \u2014 node dist/cli.js <command> [options]

Commands:
  export                Export .crash files from .xccrashpoint packages into MainCrashLogsFolder/XCodeCrashLogs
    --dry-run           Preview what would be exported without writing files
    --num-days <n>      Number of days to process (1\u2013180, default: CRASH_NUM_DAYS from config or 1)
  batch                 Symbolicate all crash files in MainCrashLogsFolder (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs)
                        using Xcode's symbolicatecrash tool
    --file <path>       Symbolicate only this single .crash file instead of batch processing all directories
  analyze               Group and deduplicate crashes into a report (auto-saves JSON + CSV to AnalyzedReportsFolder)
  setup                 Create full folder structure + symlinks
    --master-branch     Path to master/live branch checkout
    --dev-branch        Path to development branch checkout
    --dsym              Path to .dSYM bundle
    --app               Path to .app bundle
  pipeline              Full export \u2192 symbolicate \u2192 analyze
    --versions v1,v2    Comma-separated version filter
    --num-days <n>      Number of days to process (1\u2013180, default: CRASH_NUM_DAYS from config or 1)
  clean                 Delete crash files older than a given date
    --before-date <date> ISO date \u2014 files with crash dates before this are deleted (required)
    --dry-run           Preview what would be deleted without deleting
  cleanup-reports       Delete analyzed report files (.json/.csv) in AnalyzedReportsFolder older than a given date
    --before-date <date> ISO date \u2014 report files older than this date are deleted (required)
    --dry-run           Preview what would be deleted without deleting
  verify-dsym           Validate a .dSYM bundle and check UUID matches against crash files in MainCrashLogsFolder
                        (the post-export location where XCode crash logs and other crashes live).
                        With no flags: dSYM is resolved from the dSYM_File symlink in CRASH_ANALYSIS_PARENT,
                        and crashes are collected from all MainCrashLogsFolder subfolders automatically.
                        --dsym and --crash/--crash-dir must be provided together, or neither.
                        --crash-dir must be within MainCrashLogsFolder.
    --dsym <path>       Path to .dSYM bundle (overrides DSYM_PATH env var and dSYM_File symlink)
    --crash <path>      Path to a single .crash or .ips file (must be within MainCrashLogsFolder) to compare UUIDs against
    --crash-dir <dir>   Directory of crash files within MainCrashLogsFolder to compare UUIDs against
  fix-status            Manage crash fix statuses (unified command)
    --action <set|unset|list>  Action to perform (required)
    --signature <sig>   Crash signature (required for set/unset)
    --note <text>       Optional note (for set action)

Environment variables: see .env.example
`);
}
(async () => {
  try {
    const flags = parseFlags(args);
    switch (command) {
      case "export":
        await cmdExport(flags);
        break;
      case "batch":
        await cmdBatch(flags);
        break;
      case "analyze":
        await cmdAnalyze(flags);
        break;
      case "setup":
        await cmdSetup(flags);
        break;
      case "pipeline":
        await cmdPipeline(flags);
        break;
      case "clean":
        cmdClean(flags);
        break;
      case "cleanup-reports":
        cmdCleanReports(flags);
        break;
      case "verify-dsym":
        await cmdVerifyDsym(flags);
        break;
      case "fix-status":
        cmdFixStatus(flags);
        break;
      default:
        printUsage();
        if (command) {
          console.error(`Unknown command: ${command}`);
          process.exit(1);
        }
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
})();
export {
  cmdAnalyze,
  cmdBatch,
  cmdClean,
  cmdCleanReports,
  cmdExport,
  cmdFixStatus,
  cmdPipeline,
  cmdSetup,
  cmdVerifyDsym,
  parseFlags
};
