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
  CLAUDE_CLI_PATH: z.string().optional().describe("Absolute path to the Claude CLI binary"),
  DSYM_PATH: z.string().optional().describe("Path to MyApp.dSYM"),
  APP_PATH: z.string().optional().describe("Path to MyApp.app"),
  APP_NAME: z.string().optional().describe("App binary name e.g. MyApp"),
  CRASH_INPUT_DIR: z.string().optional().describe("Override .xccrashpoint search dir"),
  CRASH_VERSIONS: z.string().optional().describe("Comma-separated version filter"),
  CRASH_NUM_DAYS: z.string().optional().describe("Number of days to process (1\u2013180, default: 1)"),
  CRASH_DATE_OFFSET: z.string().optional().describe("Days offset from today for end date (default: 4)"),
  MASTER_BRANCH_PATH: z.string().optional().describe("Path to current master/live branch checkout"),
  DEV_BRANCH_PATH: z.string().optional().describe("Path to current development branch checkout"),
  // Zoho Cliq
  ZOHO_CLIQ_WEBHOOK_URL: z.string().optional().describe("Zoho Cliq channel incoming webhook URL"),
  // Zoho Projects integration
  ZOHO_PROJECTS_PORTAL_ID: z.string().optional().describe("Zoho Projects portal ID"),
  ZOHO_PROJECTS_PROJECT_ID: z.string().optional().describe("Zoho Projects project ID"),
  // Bug status IDs
  ZOHO_BUG_STATUS_OPEN: z.string().optional().describe("Zoho bug status ID for Open"),
  ZOHO_BUG_STATUS_FIXED: z.string().optional().describe("Zoho bug status ID for Fixed"),
  // Bug severity IDs
  ZOHO_BUG_SEVERITY_SHOWSTOPPER: z.string().optional().describe("Severity ID: Showstopper"),
  ZOHO_BUG_SEVERITY_CRITICAL: z.string().optional().describe("Severity ID: Critical"),
  ZOHO_BUG_SEVERITY_MAJOR: z.string().optional().describe("Severity ID: Major"),
  ZOHO_BUG_SEVERITY_MINOR: z.string().optional().describe("Severity ID: Minor"),
  ZOHO_BUG_SEVERITY_NONE: z.string().optional().describe("Severity ID: None"),
  // Custom fields
  ZOHO_BUG_APP_VERSION: z.string().optional().describe("Custom field name for app version on Zoho Projects bugs"),
  ZOHO_BUG_NUM_OF_OCCURRENCES: z.string().optional().describe("Custom field name for number of occurrences on Zoho Projects bugs"),
  // App display name
  APP_DISPLAY_NAME: z.string().optional().describe("Display name of the app. Used in pipeline prompts and Cliq notifications."),
  // MCP server name
  APPTICS_MCP_NAME: z.string().optional().describe("Name of the Apptics MCP server as it appears in Claude's connector list"),
  // Apptics project identifiers
  APPTICS_PORTAL_ID: z.string().optional().describe("Apptics portal ID (zsoid)"),
  APPTICS_PROJECT_ID: z.string().optional().describe("Apptics project ID"),
  APPTICS_APP_NAME: z.string().optional().describe("App name as it appears in Apptics")
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
function getSeverityId(config, count) {
  if (count >= 50) return config.ZOHO_BUG_SEVERITY_SHOWSTOPPER;
  if (count >= 20) return config.ZOHO_BUG_SEVERITY_CRITICAL;
  if (count >= 5) return config.ZOHO_BUG_SEVERITY_MAJOR;
  if (count >= 2) return config.ZOHO_BUG_SEVERITY_MINOR;
  return config.ZOHO_BUG_SEVERITY_NONE;
}
function cleanFilesFromDir(dir, extensions, dryRun) {
  if (!fs.existsSync(dir)) return [];
  const deleted = [];
  const files = fs.readdirSync(dir).filter((f) => extensions.some((ext) => f.endsWith(ext)));
  for (const f of files) {
    const fullPath = path.join(dir, f);
    deleted.push(fullPath);
    if (!dryRun) fs.unlinkSync(fullPath);
  }
  return deleted;
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
    if (group.affected_files.length < 5) group.affected_files.push(file);
    increment(group.devices, meta.hardwareModel);
    increment(group.ios_versions, meta.osVersion);
    increment(group.app_versions, meta.appVersion);
    increment(group.sources, meta.source);
    manifest?.markProcessed(manifestKey);
  }
  const sortedGroups = Array.from(groups.values()).sort((a, b) => b.count - a.count).map((g, idx) => {
    const fs10 = fixStatuses?.[g.signature];
    return {
      ...g,
      rank: idx + 1,
      fix_status: fs10 ? { fixed: fs10.fixed, note: fs10.note } : void 0
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
import fs8 from "fs";
import os2 from "os";
import path10 from "path";

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
import os from "os";
import path8 from "path";
function generateMcpJson(config) {
  const json = {
    mcpServers: {
      "crashpoint-ios": {
        command: "npx",
        args: ["-p", "github:maanasa-s-5539/CrashPoint-IOS-MCP", "crashpoint-ios-core"],
        env: {
          CRASH_ANALYSIS_PARENT: config.CRASH_ANALYSIS_PARENT
        }
      }
    }
  };
  return JSON.stringify(json, null, 2);
}
function generatePlist(config) {
  const scriptPath = path8.join(config.CRASH_ANALYSIS_PARENT, "Automation", "run_crash_pipeline.sh");
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

// src/core/setupAutomation.ts
import fs7 from "fs";
import path9 from "path";
function setupAutomationFiles({
  force = false,
  packageRoot,
  parentDir
}) {
  const automationDir = path9.join(parentDir, "Automation");
  const logsDir = path9.join(automationDir, "ScheduledRunLogs");
  fs7.mkdirSync(automationDir, { recursive: true });
  fs7.mkdirSync(logsDir, { recursive: true });
  const templateDir = path9.join(packageRoot, "automation");
  const scaffolded = [];
  const skipped = [];
  const shTemplatePath = path9.join(templateDir, "run_crash_pipeline.sh");
  const shDestPath = path9.join(automationDir, "run_crash_pipeline.sh");
  if (force || !fs7.existsSync(shDestPath)) {
    let shContent = fs7.readFileSync(shTemplatePath, "utf-8");
    shContent = shContent.replace(/<REPLACE_WITH_PATH_TO_PARENT_HOLDER_FOLDER>/g, parentDir);
    shContent = shContent.replace(/<REPLACE_WITH_CRASHPOINT_PACKAGE_ROOT>/g, packageRoot);
    fs7.writeFileSync(shDestPath, shContent, "utf-8");
    fs7.chmodSync(shDestPath, 493);
    scaffolded.push("run_crash_pipeline.sh");
  } else {
    skipped.push("run_crash_pipeline.sh (already exists, use force=true to overwrite)");
  }
  const promptPhase1TemplatePath = path9.join(templateDir, "daily_crash_pipeline_prompt_phase1.md");
  const promptPhase1DestPath = path9.join(automationDir, "daily_crash_pipeline_prompt_phase1.md");
  if (force || !fs7.existsSync(promptPhase1DestPath)) {
    fs7.copyFileSync(promptPhase1TemplatePath, promptPhase1DestPath);
    scaffolded.push("daily_crash_pipeline_prompt_phase1.md");
  } else {
    skipped.push("daily_crash_pipeline_prompt_phase1.md (already exists, use force=true to overwrite)");
  }
  const promptPhase2TemplatePath = path9.join(templateDir, "daily_crash_pipeline_prompt_phase2.md");
  const promptPhase2DestPath = path9.join(automationDir, "daily_crash_pipeline_prompt_phase2.md");
  if (force || !fs7.existsSync(promptPhase2DestPath)) {
    fs7.copyFileSync(promptPhase2TemplatePath, promptPhase2DestPath);
    scaffolded.push("daily_crash_pipeline_prompt_phase2.md");
  } else {
    skipped.push("daily_crash_pipeline_prompt_phase2.md (already exists, use force=true to overwrite)");
  }
  return { automationDir, scaffolded, skipped, force };
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
    path10.join(getAutomationDir(config), "FixPlans")
  ];
  for (const dir of dirsToCreate) {
    if (!fs8.existsSync(dir)) {
      fs8.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }
  const scaffoldedFiles = [];
  const configJsonPath = path10.join(parentDir, "crashpoint.config.json");
  let rawConfig = {};
  if (fs8.existsSync(configJsonPath)) {
    try {
      rawConfig = JSON.parse(fs8.readFileSync(configJsonPath, "utf-8"));
    } catch {
    }
  }
  const fullConfig = {
    ...rawConfig,
    CRASH_ANALYSIS_PARENT: config.CRASH_ANALYSIS_PARENT
  };
  const mcpJsonPath = path10.join(parentDir, ".mcp.json");
  if (!fs8.existsSync(mcpJsonPath)) {
    fs8.writeFileSync(mcpJsonPath, generateMcpJson(fullConfig), "utf-8");
    scaffoldedFiles.push(mcpJsonPath);
  }
  const launchAgentsDir = path10.join(os2.homedir(), "Library", "LaunchAgents");
  const plistPath = path10.join(launchAgentsDir, "com.crashpipeline.daily_mcp.plist");
  if (!fs8.existsSync(plistPath)) {
    try {
      if (!fs8.existsSync(launchAgentsDir)) {
        fs8.mkdirSync(launchAgentsDir, { recursive: true });
      }
      fs8.writeFileSync(plistPath, generatePlist(fullConfig), "utf-8");
      scaffoldedFiles.push(plistPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not write launchd plist to ${plistPath}: ${msg}`);
    }
  }
  try {
    const packageRoot = options.packageRoot ?? path10.resolve(__dirname, "..", "..");
    const automationResult = setupAutomationFiles({
      force: options.force ?? false,
      packageRoot,
      parentDir
    });
    for (const f of automationResult.scaffolded) {
      scaffoldedFiles.push(path10.join(automationResult.automationDir, f));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`Could not scaffold automation files: ${msg}`);
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
    const resolvedTarget = path10.resolve(target);
    const linkPath = path10.join(parentDir, name);
    let status;
    if (!fs8.existsSync(resolvedTarget)) {
      warnings.push(`Target for ${name} does not exist: ${resolvedTarget}`);
    }
    try {
      fs8.lstatSync(linkPath);
      fs8.rmSync(linkPath, { force: true });
    } catch {
    }
    let symlinkType = "file";
    if (fs8.existsSync(resolvedTarget)) {
      symlinkType = fs8.statSync(resolvedTarget).isDirectory() ? "dir" : "file";
    } else {
      const lowerTarget = resolvedTarget.toLowerCase();
      if (lowerTarget.endsWith(".dsym") || lowerTarget.endsWith(".app") || lowerTarget.endsWith(".framework") || !path10.extname(resolvedTarget)) {
        symlinkType = "dir";
      }
    }
    try {
      fs8.symlinkSync(resolvedTarget, linkPath, symlinkType);
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

// src/core/cleanup.ts
function cleanupAll(options = {}) {
  const dryRun = options.dryRun ?? false;
  const keepReports = options.keepReports ?? false;
  const keepManifests = options.keepManifests ?? false;
  const config = getConfig();
  const counts = {
    xcodeCrashLogs: 0,
    appticsCrashLogs: 0,
    otherCrashLogs: 0,
    symbolicatedCrashLogs: 0,
    analyzedReports: 0,
    stateManifests: 0
  };
  const deletedFiles = [];
  function accumulate(files, countKey) {
    deletedFiles.push(...files);
    counts[countKey] += files.length;
  }
  accumulate(cleanFilesFromDir(getXcodeCrashesDir(config), [".crash", ".ips"], dryRun), "xcodeCrashLogs");
  accumulate(cleanFilesFromDir(getAppticsCrashesDir(config), [".crash", ".ips"], dryRun), "appticsCrashLogs");
  accumulate(cleanFilesFromDir(getOtherCrashesDir(config), [".crash", ".ips"], dryRun), "otherCrashLogs");
  accumulate(cleanFilesFromDir(getSymbolicatedDir(config), [".crash", ".ips"], dryRun), "symbolicatedCrashLogs");
  if (!keepReports) {
    accumulate(cleanFilesFromDir(getAnalyzedReportsDir(config), [".json", ".csv"], dryRun), "analyzedReports");
  }
  if (!keepManifests) {
    accumulate(cleanFilesFromDir(getStateMaintenanceDir(config), [".json"], dryRun), "stateManifests");
  }
  const totalDeleted = Object.values(counts).reduce((s, n) => s + n, 0);
  return { dryRun, deleted: counts, totalDeleted, files: deletedFiles };
}

// src/core/appticsFormatter.ts
function isoToAppticsDate(isoDate) {
  const [yyyy, mm, dd] = isoDate.split("-");
  return `${dd}-${mm}-${yyyy}`;
}
function formatCrashFile(detail, entry) {
  const lines = [];
  lines.push(`Incident Identifier: ${detail.UniqueMessageID ?? entry.UniqueMessageID}`);
  lines.push(`CrashReporter Key:   ${detail.DeviceID ?? "unknown"}`);
  lines.push(`Hardware Model:      ${detail.Model ?? "unknown"}`);
  lines.push(`Process:             ${entry.Exception ?? detail.IssueName ?? "unknown"}`);
  lines.push(`Date/Time:           ${detail.date ?? detail.HappenedAt ?? "unknown"}`);
  lines.push(`OS Version:          ${detail.OS ?? entry.OS ?? "unknown"} ${detail.OSVersion ?? ""}`);
  lines.push(`App Version:         ${detail.AppVersion ?? entry.AppVersion ?? "unknown"} (${detail.AppReleaseVersion ?? ""})`);
  lines.push("");
  lines.push(`Exception Type:  ${entry.Exception ?? detail.IssueName ?? "unknown"}`);
  if (detail.Message) {
    lines.push(`Exception Note:  ${detail.Message}`);
  }
  lines.push("");
  const trace = detail.Exception ?? "";
  if (trace) {
    lines.push("Thread 0 Crashed:");
    lines.push(trace);
    lines.push("");
  }
  lines.push("--- Apptics Metadata ---");
  lines.push("Warning: This crash file contains only Apptics metadata \u2014 no full crash report was available.");
  lines.push(`Source:          Apptics`);
  lines.push(`UniqueMessageID: ${entry.UniqueMessageID}`);
  lines.push(`CrashCount:      ${entry.CrashCount}`);
  lines.push(`DevicesCount:    ${entry.DevicesCount}`);
  lines.push(`UsersCount:      ${entry.UsersCount}`);
  if (detail.NetworkStatus) lines.push(`NetworkStatus:   ${detail.NetworkStatus}`);
  if (detail.BatteryStatus) lines.push(`BatteryStatus:   ${detail.BatteryStatus}`);
  if (detail.Edge) lines.push(`Edge:            ${detail.Edge}`);
  if (detail.Screen) lines.push(`Screen:          ${detail.Screen}`);
  if (detail.CustomProperties) lines.push(`CustomProperties: ${detail.CustomProperties}`);
  lines.push("");
  return lines.join("\n");
}

// src/state/fixTracker.ts
import fs9 from "fs";
import path11 from "path";
var FixTracker = class {
  constructor(parentDir) {
    this.filePath = path11.join(parentDir, "StateMaintenance", "fix_status.json");
  }
  load() {
    try {
      if (fs9.existsSync(this.filePath)) {
        const raw = fs9.readFileSync(this.filePath, "utf-8");
        return JSON.parse(raw);
      }
    } catch {
    }
    return {};
  }
  save(store) {
    fs9.mkdirSync(path11.dirname(this.filePath), { recursive: true });
    fs9.writeFileSync(this.filePath, JSON.stringify(store, null, 2), "utf-8");
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
  cleanFilesFromDir,
  cleanOldCrashes,
  cleanupAll,
  detectSource,
  exportCrashLogs,
  exportReportToCsv,
  extractIncidentId,
  filterUnfixedGroups,
  formatCrashFile,
  generateMcpJson,
  generatePlist,
  getAnalyzedReportsDir,
  getAppticsCrashesDir,
  getAutomationDir,
  getConfig,
  getLatestCsvReportPath,
  getLatestJsonReportPath,
  getMainCrashLogsDir,
  getOtherCrashesDir,
  getSeverityId,
  getStateMaintenanceDir,
  getSymbolicatedDir,
  getXcodeCrashesDir,
  hasCrashFiles,
  isoToAppticsDate,
  loadFixStatuses,
  parseCrashMetadata,
  reportToCsvString,
  runBatch,
  runBatchAll,
  setupAutomationFiles,
  setupWorkspace,
  symbolicateOne
};
