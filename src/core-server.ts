#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import { getConfig, getXcodeCrashesDir, getMainCrashLogsDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, getAnalyzedReportsDir, getStateMaintenanceDir, hasCrashFiles, getSeverityId } from "./config.js";
import type { CrashReport, CrashGroup } from "./core/crashAnalyzer.js";
import { filterUnfixedGroups } from "./core/crashAnalyzer.js";
import { formatCrashFile } from "./core/appticsFormatter.js";
import type { AppticsCrashEntry, AppticsCrashDetail } from "./core/appticsFormatter.js";
import {
  exportCrashLogs,
} from "./core/crashExporter.js";
import {
  symbolicateOne,
  runBatchAll,
  symbolicateFiles,
  BatchResult,
} from "./core/symbolicator.js";
import { analyzeDirectory, analyzeFiles, cleanOldCrashes } from "./core/crashAnalyzer.js";
import { cleanOldReports } from "./core/reportCleaner.js";
import { FixTracker, loadFixStatuses } from "./state/fixTracker.js";
import { assertPathUnderBase, assertNoTraversal } from "./pathSafety.js";
import { exportReportToCsv } from "./core/csvExporter.js";
import { ProcessedManifest, extractIncidentId } from "./state/processedManifest.js";
import { validateDateInput, computeDateRange } from "./dateValidation.js";
import { setupWorkspace } from "./core/setup.js";

const execFileAsync = promisify(execFile);

const server = new McpServer({
  name: "crashpoint-ios-core",
  version: "1.0.0",
});

// ── Tool 1: setup_folders ────────────────────────────────────────────────────
server.registerTool(
  "setup_folders",
  {
    description:
      "Create the full ParentHolderFolder directory structure (MainCrashLogsFolder/XCodeCrashLogs, MainCrashLogsFolder/AppticsCrashLogs, MainCrashLogsFolder/OtherCrashLogs, SymbolicatedCrashLogsFolder, AnalyzedReportsFolder, StateMaintenance, Automation, Automation/FixPlans, Automation/ScheduledRunLogs), generate .mcp.json and launchd plist, scaffold automation scripts (run_crash_pipeline.sh, daily_crash_pipeline_prompt_phase1.md, daily_crash_pipeline_prompt_phase2.md), and create optional symlinks for master/dev branches. Run this once to complete the entire setup. All symlink paths are pre-configured via environment variables — do NOT ask the user for them unless they explicitly want to override.",
    inputSchema: z.object({
      masterBranchPath: z.string().optional().describe("ALREADY CONFIGURED via MASTER_BRANCH_PATH env var. Do NOT ask the user. Only provide to override. Creates CurrentMasterLiveBranch symlink."),
      devBranchPath: z.string().optional().describe("ALREADY CONFIGURED via DEV_BRANCH_PATH env var. Do NOT ask the user. Only provide to override. Creates CurrentDevelopmentBranch symlink."),
      dsymPath: z.string().optional().describe("ALREADY CONFIGURED via DSYM_PATH env var. Do NOT ask the user. Only provide to override. Creates dSYM_File symlink."),
      appPath: z.string().optional().describe("ALREADY CONFIGURED via APP_PATH env var. Do NOT ask the user. Only provide to override. Creates app_File symlink."),
      force: z.boolean().optional().describe("When true, overwrite existing automation files (run_crash_pipeline.sh, phase prompts) with the latest version. Default false (skip existing files)."),
    }),
    outputSchema: z.object({
      parentDir: z.string(),
      created: z.array(z.string()),
      symlinks: z.array(z.object({ link: z.string(), target: z.string(), status: z.string() })),
      scaffoldedFiles: z.array(z.string()),
      warnings: z.array(z.string()),
    }),
  },
  async (input) => {
    const result = setupWorkspace({
      masterBranchPath: input.masterBranchPath,
      devBranchPath: input.devBranchPath,
      dsymPath: input.dsymPath,
      appPath: input.appPath,
      force: input.force,
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 2: export_crashes ───────────────────────────────────────────────────
server.registerTool(
  "export_crashes",
  {
    description:
      "Export .crash files from .xccrashpoint packages into MainCrashLogsFolder/XCodeCrashLogs. When dryRun is true, shows what would be exported without writing any files.",
    inputSchema: z.object({
      inputDir: z.string().optional().describe("Directory to search for .xccrashpoint files"),
      outputDir: z.string().optional().describe("Destination directory for crash logs"),
      versions: z.string().optional().describe("Comma-separated version filter"),
      recursive: z.boolean().optional().describe("Search subdirectories recursively"),
      numDays: z.number().optional().describe("Number of days to process (1–180). End date = today minus CRASH_DATE_OFFSET (default 4 from config), start date = end date minus numDays + 1. Overrides CRASH_NUM_DAYS in config. Default: 1."),
      dryRun: z.boolean().optional().describe("When true, shows what would be exported without writing any files"),
      includeProcessedCrashes: z.boolean().optional().describe("When true, re-processes crashes that were already exported. Default is false (skip already-processed crashes)."),
    }),
    outputSchema: z.object({
      canBeExported: z.number().optional(),
      exported: z.number(),
      skipped: z.number(),
      errors: z.array(z.string()),
      files: z.array(
        z.object({
          source: z.string(),
          destination: z.string(),
          version: z.string(),
          skipped: z.boolean(),
          reason: z.string().optional(),
        })
      ),
    }),
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
    const manifest = dryRun || input.includeProcessedCrashes ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");

    const offset = parseInt(config.CRASH_DATE_OFFSET ?? "4", 10);
    const numDays = input.numDays ?? parseInt(config.CRASH_NUM_DAYS ?? "1", 10);
    const { startDateISO, endDateISO } = computeDateRange(numDays, offset);

    const result = exportCrashLogs(inputDir, outputDir, versions, recursive, dryRun, startDateISO, endDateISO, manifest);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 4: symbolicate_batch ────────────────────────────────────────────────
server.registerTool(
  "symbolicate_batch",
  {
    description:
      "Symbolicate crash files using Xcode's symbolicatecrash tool. When the optional 'file' parameter is provided, symbolicates only that single .crash file. Otherwise, processes ALL .crash and .ips files in MainCrashLogsFolder (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs), outputting to SymbolicatedCrashLogsFolder. All paths (dSYM, directories) are pre-configured via environment variables — do NOT ask the user for them unless they explicitly want to override.",
    inputSchema: z.object({
      file: z.string().optional().describe("Path to a single .crash or .ips file to symbolicate. When provided, only this file is processed instead of batch processing all directories."),
      dsymPath: z.string().optional().describe("ALREADY CONFIGURED via DSYM_PATH env var. Do NOT ask the user for this. Only provide if the user explicitly wants to override the configured default."),
      outputDir: z.string().optional().describe("ALREADY CONFIGURED via env (SymbolicatedCrashLogsFolder). Do NOT ask the user for this. Only provide to override."),
      includeProcessedCrashes: z.boolean().optional().describe("When true, re-symbolicate crashes that were already processed. Default is false (skip already-processed crashes)."),
    }),
    outputSchema: z.object({
      succeeded: z.number(),
      failed: z.number(),
      total: z.number(),
      results: z.array(
        z.object({
          file: z.string(),
          success: z.boolean(),
        })
      ),
    }),
  },
  async (input) => {
    const config = getConfig();
    const dsymPath = input.dsymPath ?? config.DSYM_PATH;
    const outputDir = input.outputDir ?? getSymbolicatedDir(config);
    if (input.outputDir) assertPathUnderBase(input.outputDir, config.CRASH_ANALYSIS_PARENT);
    if (input.dsymPath) assertNoTraversal(input.dsymPath);

    if (!dsymPath) {
      const result = { succeeded: 0, failed: 0, total: 0, results: [] };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    // Single-file mode
    if (input.file) {
      assertNoTraversal(input.file);
      const outputPath = path.join(outputDir, path.basename(input.file));
      const res = await symbolicateOne(input.file, dsymPath, outputPath);
      const result = {
        succeeded: res.success ? 1 : 0,
        failed: res.success ? 0 : 1,
        total: 1,
        results: [{ file: path.basename(input.file), success: res.success }],
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    const xcodeCrashDir = getXcodeCrashesDir(config);
    const appticsDir = getAppticsCrashesDir(config);
    const otherDir = getOtherCrashesDir(config);
    const manifest = input.includeProcessedCrashes ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "symbolicate");

    const anyFiles = hasCrashFiles(xcodeCrashDir) || hasCrashFiles(appticsDir) || hasCrashFiles(otherDir);

    if (!anyFiles) {
      const result = {
        succeeded: 0,
        failed: 0,
        total: 0,
        results: [] as BatchResult[],
        message: "No .crash or .ips files found in MainCrashLogsFolder/XCodeCrashLogs, MainCrashLogsFolder/AppticsCrashLogs, or MainCrashLogsFolder/OtherCrashLogs",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: { succeeded: 0, failed: 0, total: 0, results: [] } as unknown as Record<string, unknown>,
      };
    }

    const r = await runBatchAll(dsymPath, manifest);
    const result = { succeeded: r.succeeded, failed: r.failed, total: r.total, results: r.results };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 5: verify_dsym ──────────────────────────────────────────────────────
server.registerTool(
  "verify_dsym",
  {
    description:
      "Validate a .dSYM bundle and check if its UUIDs match those in crash files collected from MainCrashLogsFolder (the post-export location where XCode crash logs and other crashes live). Runs dwarfdump --uuid on the dSYM and parses Binary Images sections from crash files. Requires macOS with Xcode CLI tools. When no dsymPath is given, resolves the dSYM_File symlink in CRASH_ANALYSIS_PARENT. When no crashPath/crashDir is given, auto-collects crash files from all MainCrashLogsFolder subfolders (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs). crashDir must be within MainCrashLogsFolder. dsymPath and crashPath/crashDir must be provided together, or neither. If APP_NAME is set, only the UUID of the app binary is extracted from crash files (recommended to avoid false mismatches from system framework UUIDs).",
    inputSchema: z.object({
      dsymPath: z.string().optional().describe("Path to .dSYM bundle (defaults to DSYM_PATH env var, then dSYM_File symlink in CRASH_ANALYSIS_PARENT). Must be provided together with crashPath/crashDir, or omitted entirely."),
      crashPath: z.string().optional().describe("Path to a single .crash or .ips file to compare UUIDs against. Must be provided together with dsymPath, or omitted entirely."),
      crashDir: z.string().optional().describe("Directory of crash files to compare UUIDs against (all .crash/.ips files in the directory). Must be provided together with dsymPath, or omitted entirely."),
    }),
    outputSchema: z.object({
      valid: z.boolean(),
      dsymPath: z.string(),
      dsymUuids: z.array(z.object({ arch: z.string(), uuid: z.string() })),
      crashFileUuids: z.array(z.object({ file: z.string(), uuid: z.string() })).optional(),
      matches: z.array(z.object({ uuid: z.string(), arch: z.string(), matchedFiles: z.array(z.string()) })).optional(),
      mismatches: z.array(z.string()).optional(),
      detail: z.string(),
    }),
  },
  async (input) => {
    const config = getConfig();

    const hasDsymInput = Boolean(input.dsymPath);
    const hasCrashInput = Boolean(input.crashPath || input.crashDir);

    if (hasDsymInput && !hasCrashInput) {
      const result = {
        valid: false,
        dsymPath: input.dsymPath ?? "",
        dsymUuids: [],
        detail: "dsymPath was provided but no crashPath or crashDir was given. Either supply both or neither.",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }
    if (!hasDsymInput && hasCrashInput) {
      const result = {
        valid: false,
        dsymPath: "",
        dsymUuids: [],
        detail: "crashPath/crashDir was provided but no dsymPath was given. Either supply both or neither.",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    let dsymPath: string;
    if (input.dsymPath) {
      dsymPath = input.dsymPath;
    } else if (config.DSYM_PATH) {
      dsymPath = config.DSYM_PATH;
    } else {
      const symlinkPath = path.join(config.CRASH_ANALYSIS_PARENT, "dSYM_File");
      try {
        dsymPath = fs.realpathSync(symlinkPath);
      } catch {
        const result = {
          valid: false,
          dsymPath: "",
          dsymUuids: [],
          detail: "dsymPath not provided, DSYM_PATH env var not set, and no dSYM_File symlink found in CRASH_ANALYSIS_PARENT. Run setup to create the symlink.",
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      }
    }

    assertNoTraversal(dsymPath);

    if (!fs.existsSync(dsymPath)) {
      const result = {
        valid: false,
        dsymPath,
        dsymUuids: [],
        detail: `dSYM not found at: ${dsymPath}`,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    let resolvedDsymPath: string;
    try {
      resolvedDsymPath = fs.realpathSync(dsymPath);
    } catch {
      resolvedDsymPath = dsymPath;
    }

    let dwarfOutput = "";
    try {
      const { stdout } = await execFileAsync("dwarfdump", ["--uuid", resolvedDsymPath]);
      dwarfOutput = stdout;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const result = {
        valid: false,
        dsymPath,
        dsymUuids: [],
        detail: `dwarfdump failed: ${msg}`,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    const uuidLineRe = /UUID:\s+([0-9A-F-]+)\s+\(([^)]+)\)/gi;
    const dsymUuids: Array<{ arch: string; uuid: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = uuidLineRe.exec(dwarfOutput)) !== null) {
      dsymUuids.push({ uuid: match[1].toUpperCase(), arch: match[2] });
    }

    if (dsymUuids.length === 0) {
      const result = {
        valid: false,
        dsymPath,
        dsymUuids: [],
        detail: "dwarfdump produced no UUID output — the dSYM may be malformed.",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    const crashFiles: string[] = [];
    if (hasCrashInput) {
      if (input.crashPath) {
        assertNoTraversal(input.crashPath);
        assertPathUnderBase(input.crashPath, getMainCrashLogsDir(config));
        crashFiles.push(input.crashPath);
      }
      if (input.crashDir) {
        assertPathUnderBase(input.crashDir, getMainCrashLogsDir(config));
        if (fs.existsSync(input.crashDir)) {
          fs.readdirSync(input.crashDir)
            .filter((f) => f.endsWith(".crash") || f.endsWith(".ips"))
            .forEach((f) => crashFiles.push(path.join(input.crashDir!, f)));
        }
      }
    } else {
      const dirs = [
        getXcodeCrashesDir(config),
        getAppticsCrashesDir(config),
        getOtherCrashesDir(config),
      ];
      for (const dir of dirs) {
        if (fs.existsSync(dir)) {
          fs.readdirSync(dir)
            .filter((f) => f.endsWith(".crash") || f.endsWith(".ips"))
            .forEach((f) => crashFiles.push(path.join(dir, f)));
        }
      }
    }

    if (crashFiles.length === 0) {
      const result = {
        valid: true,
        dsymPath,
        dsymUuids,
        detail: `dSYM is valid. Found ${dsymUuids.length} UUID(s): ${dsymUuids.map((u) => `${u.arch}=${u.uuid}`).join(", ")}. No crash files found for UUID comparison.`,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    const binaryImgRe = /^\s*0x[0-9a-fA-F]+\s+-\s+0x[0-9a-fA-F]+\s+(\S+)\s+\S+\s+<([0-9a-f]{32})>/gim;
    const appName = config.APP_NAME;
    const crashFileUuids: Array<{ file: string; uuid: string }> = [];

    for (const crashFile of crashFiles) {
      let content = "";
      try {
        content = fs.readFileSync(crashFile, "utf-8");
      } catch {
        continue;
      }
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
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
          crashFileUuids.push({ file: path.basename(crashFile), uuid });
        }
      }
    }

    const dsymUuidSet = new Set(dsymUuids.map((u) => u.uuid));
    const matches: Array<{ uuid: string; arch: string; matchedFiles: string[] }> = [];
    const mismatches: string[] = [];

    for (const { uuid, arch } of dsymUuids) {
      const matchedFiles = crashFileUuids
        .filter((c) => c.uuid === uuid)
        .map((c) => c.file);
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
    const detail = matches.length > 0
      ? `${matches.length} UUID match(es) found. ${mismatches.length > 0 ? `${mismatches.length} mismatch(es): ${mismatches.slice(0, 3).join("; ")}` : "All UUIDs matched."}`
      : `No UUID matches found. ${mismatches.length} mismatch(es). Symbolication will likely fail — ensure the correct dSYM for this build is used.`;

    const result = {
      valid,
      dsymPath,
      dsymUuids,
      crashFileUuids,
      matches,
      mismatches,
      detail,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 6: analyze_crashes ──────────────────────────────────────────────────
server.registerTool(
  "analyze_crashes",
  {
    description:
      "Group and deduplicate symbolicated crashes by unique signature. Always reads from SymbolicatedCrashLogsFolder. Automatically generates both a JSON report (jsonReport_<timestamp>.json) and a CSV report (sheetReport_<timestamp>.csv) in AnalyzedReportsFolder. Also returns the full JSON report in the response.",
    inputSchema: z.object({
      includeProcessedCrashes: z.boolean().optional().describe("When true, re-analyzes crashes that were already processed. Default is false (skip already-processed crashes)."),
    }),
    outputSchema: z.object({
      report_date: z.string(),
      source_dir: z.string(),
      total_crashes: z.number(),
      unique_crash_types: z.number(),
      crash_groups: z.array(z.any()),
      json_report_path: z.string(),
      csv_report_path: z.string(),
      csv_export: z.object({ success: z.boolean(), message: z.string(), filePath: z.string(), totalRows: z.number() }).optional(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const crashDir = getSymbolicatedDir(config);
    const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
    const manifest = input.includeProcessedCrashes ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "analyze");
    const report = analyzeDirectory(crashDir, fixStatuses, manifest);

    const reportsDir = getAnalyzedReportsDir(config);
    fs.mkdirSync(reportsDir, { recursive: true });
    const ts = Date.now();
    const jsonReportPath = path.join(reportsDir, `jsonReport_${ts}.json`);
    const csvReportPath = path.join(reportsDir, `sheetReport_${ts}.csv`);

    fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2), "utf-8");
    const csvExport = exportReportToCsv(report, csvReportPath);

    const latestJsonPath = path.join(reportsDir, "latest.json");
    const latestCsvPath = path.join(reportsDir, "latest.csv");
    fs.copyFileSync(jsonReportPath, latestJsonPath);
    fs.copyFileSync(csvReportPath, latestCsvPath);

    const result = {
      ...report,
      json_report_path: jsonReportPath,
      csv_report_path: csvReportPath,
      csv_export: csvExport,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 7: fix_status ────────────────────────────────────────────────────────
server.registerTool(
  "fix_status",
  {
    description: "Manage crash fix statuses. Use action='set' to mark a signature as fixed/unfixed, action='unset' to clear fix status, action='list' to show all tracked statuses.",
    inputSchema: z.object({
      action: z.enum(["set", "unset", "list"]).describe("Action to perform: 'set' to mark fixed/unfixed, 'unset' to mark unfixed, 'list' to show all statuses"),
      signature: z.string().optional().describe("Crash signature string (required for set and unset actions)"),
      fixed: z.boolean().optional().describe("Whether the crash is fixed (used with action='set', defaults to true)"),
      note: z.string().optional().describe("Optional note (e.g. PR reference)"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      action: z.string(),
      result: z.any(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);

    if (input.action === "list") {
      const statuses = tracker.getAll();
      const result = {
        success: true,
        action: "list",
        result: {
          total: statuses.length,
          fixed: statuses.filter((s) => s.fixed).length,
          unfixed: statuses.filter((s) => !s.fixed).length,
          statuses,
        },
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    if (!input.signature) {
      const result = {
        success: false,
        action: input.action,
        result: `signature is required for action '${input.action}'`,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    if (input.action === "set") {
      const fixed = input.fixed ?? true;
      const status = tracker.setFixed(input.signature, fixed, input.note);
      const result = {
        success: true,
        action: "set",
        result: `Marked as ${status.fixed ? "fixed" : "unfixed"}${status.note ? ` — ${status.note}` : ""} at ${status.updatedAt}`,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    // action === "unset"
    const status = tracker.setFixed(input.signature, false);
    const result = {
      success: true,
      action: "unset",
      result: `Marked as unfixed at ${status.updatedAt}`,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 8: run_basic_pipeline ───────────────────────────────────────────────
server.registerTool(
  "run_basic_pipeline",
  {
    description:
      "Run the basic crash analysis pipeline: export → symbolicate → analyze. All paths (dSYM, app, directories) are auto-configured from environment variables — no path input is required.",
    inputSchema: z.object({
      versions: z.string().optional().describe("Comma-separated version filter for export"),
      numDays: z.number().optional().describe("Number of days to process (1–180). End date = today minus CRASH_DATE_OFFSET (default 4 from config), start date = end date minus numDays + 1. Overrides CRASH_NUM_DAYS in config. Default: 1."),
      includeProcessedCrashes: z.boolean().optional().describe("When true, re-processes crashes that were already exported/symbolicated/analyzed. Default is false (skip already-processed crashes)."),
    }),
    outputSchema: z.object({
      export_result: z.any(),
      symbolication_result: z.any(),
      analysis_report: z.any(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
    const basicDir = getXcodeCrashesDir(config);
    const symbolicatedDir = getSymbolicatedDir(config);
    const dsymPath = config.DSYM_PATH;
    const versions =
      input.versions?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
    const includeProcessed = input.includeProcessedCrashes === true;

    const offset = parseInt(config.CRASH_DATE_OFFSET ?? "4", 10);
    const numDays = input.numDays ?? parseInt(config.CRASH_NUM_DAYS ?? "1", 10);
    const { startDateISO, endDateISO } = computeDateRange(numDays, offset);
    const rangeKey = `${startDateISO}..${endDateISO}`;

    // ── Fast-path: skip entire pipeline if range is already covered ──────
    if (!includeProcessed) {
      const fastPathManifest = new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
      if (fastPathManifest.isRangeCovered(startDateISO, endDateISO)) {
        const skippedResult = {
          export_result: { skipped: true, reason: `Range ${rangeKey} already fully processed` },
          symbolication_result: { skipped: true, reason: `Range ${rangeKey} already fully processed` },
          analysis_report: { skipped: true, reason: `Range ${rangeKey} already fully processed` },
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(skippedResult, null, 2) }],
          structuredContent: skippedResult as unknown as Record<string, unknown>,
        };
      }
    }

    // ── Step 1: Export (date-filtered + per-crash dedup) ─────────────────
    const exportManifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
    const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false, startDateISO, endDateISO, exportManifest);

    // Collect only the files that were freshly exported in this run
    const exportedPaths = exportResult.files
      .filter((f) => !f.skipped)
      .map((f) => f.destination);

    // ── Step 2: Symbolicate ONLY the freshly exported files ──────────────
    let symbolicationResult: object = { skipped: true, reason: "DSYM_PATH not configured" };
    let symbolicatedPaths: string[] = [];

    if (dsymPath) {
      if (exportedPaths.length === 0) {
        symbolicationResult = { skipped: true, reason: "No new files were exported for this date range" };
      } else {
        const symbolicateManifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "symbolicate");
        const batchRes = await symbolicateFiles(exportedPaths, dsymPath, symbolicatedDir, symbolicateManifest);
        symbolicationResult = batchRes;
        symbolicatedPaths = batchRes.results
          .filter((r) => r.success)
          .map((r) => path.join(symbolicatedDir, r.file));
      }
    }

    // ── Step 3: Analyze ONLY the freshly symbolicated files ──────────────
    const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
    const analyzeManifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "analyze");
    const analysisReport = analyzeFiles(symbolicatedPaths, fixStatuses, analyzeManifest);

    // ── Save report ───────────────────────────────────────────────────────
    const reportsDir = getAnalyzedReportsDir(config);
    const ts = Date.now();
    const reportFile = path.join(reportsDir, `jsonReport_${ts}.json`);
    const csvFile = path.join(reportsDir, `sheetReport_${ts}.csv`);
    try {
      fs.mkdirSync(reportsDir, { recursive: true });
      fs.writeFileSync(reportFile, JSON.stringify(analysisReport, null, 2), "utf-8");
      exportReportToCsv(analysisReport, csvFile);
      const latestJsonPath = path.join(reportsDir, "latest.json");
      const latestCsvPath = path.join(reportsDir, "latest.csv");
      fs.copyFileSync(reportFile, latestJsonPath);
      fs.copyFileSync(csvFile, latestCsvPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Warning: failed to save report to ${reportFile}: ${msg}`);
    }

    // ── Record completed pipeline run ─────────────────────────────────────
    const pipelineManifest = new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export");
    const resolvedCrashIds = exportedPaths.map((p) => extractIncidentId(p) ?? path.basename(p));
    pipelineManifest.recordPipelineRun(rangeKey, {
      startDate: startDateISO,
      endDate: endDateISO,
      completedAt: new Date().toISOString(),
      crashIds: resolvedCrashIds,
      exportedCount: exportedPaths.length,
      symbolicatedCount: symbolicatedPaths.length,
      analyzedCount: analysisReport.total_crashes,
      reportPath: reportFile,
    });

    const result = {
      export_result: exportResult,
      symbolication_result: symbolicationResult,
      analysis_report: analysisReport,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 9: clean_old_crashes ────────────────────────────────────────────────
server.registerTool(
  "clean_old_crashes",
  {
    description:
      "Delete .crash and .ips files older than a given date from MainCrashLogsFolder (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs) and SymbolicatedCrashLogsFolder. Crash date is read from the file header (Date/Time field); falls back to filesystem modification time if not found. Use dryRun to preview what would be deleted.",
    inputSchema: z.object({
      beforeDate: z.string().describe("ISO date string — files with crash dates before this date will be deleted (e.g. 2026-03-01)"),
      dryRun: z.boolean().optional().describe("When true, reports what would be deleted without actually deleting (default: false)"),
    }),
    outputSchema: z.object({
      deleted: z.number(),
      skipped: z.number(),
      totalScanned: z.number(),
      files: z.array(
        z.object({
          file: z.string(),
          crashDate: z.string(),
          deleted: z.boolean(),
        })
      ),
    }),
  },
  async (input) => {
    const config = getConfig();
    const dryRun = input.dryRun ?? false;

    try {
      validateDateInput(input.beforeDate, "beforeDate");
    } catch (err) {
      return { content: [{ type: "text" as const, text: (err as Error).message }] };
    }

    const dirs = [
      getXcodeCrashesDir(config),
      getAppticsCrashesDir(config),
      getOtherCrashesDir(config),
      getSymbolicatedDir(config),
    ];

    const result = cleanOldCrashes(input.beforeDate, dirs, dryRun, config.CRASH_ANALYSIS_PARENT, dryRun ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT, "export"));
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 9 (cleanup_reports) ─────────────────────────────────────────────────
server.registerTool(
  "cleanup_reports",
  {
    description:
      "Delete analyzed report files (.json and .csv) in AnalyzedReportsFolder that are older than a given date. Targets timestamped report files generated by the analysis pipeline (jsonReport_<timestamp>.json, sheetReport_<timestamp>.csv). Stable pointer files (latest.json, latest.csv) are never deleted. Use dryRun to preview what would be deleted.",
    inputSchema: z.object({
      beforeDate: z.string().describe("ISO date string — analyzed report files with a report date before this date will be deleted (e.g. 2026-03-01)"),
      dryRun: z.boolean().optional().describe("When true, reports what would be deleted without actually deleting (default: false)"),
    }),
    outputSchema: z.object({
      deleted: z.number(),
      skipped: z.number(),
      totalScanned: z.number(),
      files: z.array(
        z.object({
          file: z.string(),
          reportDate: z.string(),
          deleted: z.boolean(),
        })
      ),
    }),
  },
  async (input) => {
    const config = getConfig();
    const dryRun = input.dryRun ?? false;

    try {
      validateDateInput(input.beforeDate, "beforeDate");
    } catch (err) {
      return { content: [{ type: "text" as const, text: (err as Error).message }] };
    }

    const reportsDir = getAnalyzedReportsDir(config);
    const result = cleanOldReports(input.beforeDate, reportsDir, dryRun);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);


// ── Helpers (Integration tools) ──────────────────────────────────────────────

function findLatestReport(analyzedDir: string): string {
  const latestPointer = path.join(analyzedDir, "latest.json");
  if (fs.existsSync(latestPointer)) return latestPointer;
  try {
    const files = fs
      .readdirSync(analyzedDir)
      .filter((f) => f.match(/^jsonReport_.*\.json$/))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(analyzedDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length > 0) return path.join(analyzedDir, files[0].name);
  } catch {
    // fall through
  }
  return path.join(analyzedDir, "jsonReport.json");
}

function buildBugTitle(group: CrashGroup): string {
  const sigSnippet = (group.signature ?? "unknown").slice(0, 30);
  return `[CrashPoint] ${group.exception_type} — ${sigSnippet}`;
}

function buildBugDescription(group: CrashGroup, occurrences: number, crashDates: string[]): string {
  const devicesSummary = Object.entries(group.devices ?? {}).map(([k, v]) => `${k}(${v})`).join(", ");
  const iosSummary = Object.entries(group.ios_versions ?? {}).map(([k, v]) => `${k}(${v})`).join(", ");
  const appVSummary = Object.entries(group.app_versions ?? {}).map(([k, v]) => `${k}(${v})`).join(", ");
  const sourcesSummary = Object.entries(group.sources ?? {}).map(([k, v]) => `${k}(${v})`).join(", ");

  const lines: string[] = [
    `**Exception Type:** ${group.exception_type}`,
    `**Exception Codes:** ${group.exception_codes ?? "N/A"}`,
    `**Occurrences:** ${occurrences}`,
    `**Crash Dates:** ${crashDates.length > 0 ? crashDates.join(", ") : "N/A"}`,
    "",
    "**Top Frames:**",
    ...(group.top_frames ?? []).map((f: string, i: number) => `  ${i}. ${f}`),
    "",
    `**Affected Devices:** ${devicesSummary || "N/A"}`,
    `**iOS Versions:** ${iosSummary || "N/A"}`,
    `**App Versions:** ${appVSummary || "N/A"}`,
    `**Sources:** ${sourcesSummary || "N/A"}`,
  ];
  if (group.crashed_thread) lines.push("", `**Crashed Thread:** ${group.crashed_thread.display}`);
  return lines.join("\n");
}

function formatDateDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function stripBuildNumber(version: string): string {
  return version.replace(/\s*\(.*?\)/, "").trim();
}

function buildCliqMessage(report: CrashReport, groups: CrashGroup[]): object {
  const date = report.report_date
    ? formatDateDDMMYYYY(new Date(report.report_date))
    : formatDateDDMMYYYY(new Date());
  const totalCrashes = groups.reduce((sum, g) => sum + (g.count ?? 0), 0);
  const uniqueTypes = new Set(groups.map((g) => g.exception_type)).size;
  const topGroups = groups.slice(0, 10);
  const groupLines = topGroups
    .map((g, i) => {
      const rank = i + 1;
      const fixed = g.fix_status?.fixed ? "✅ Fixed" : "🔴 Open";
      const topFrame = g.top_frames?.[0] ?? "unknown";
      return `${rank}. [${g.count}x] ${g.exception_type} @ ${topFrame} — ${fixed}`;
    })
    .join("\n\n");
  const text = [
    `🔴 *CrashPoint Report — ${date}*`,
    `Total crashes: ${totalCrashes} | Unique types: ${uniqueTypes}`,
    "",
    groupLines,
  ].join("\n");
  return { text, card: { title: `🔴 CrashPoint Report — ${date}`, theme: "modern-inline" } };
}

function computeIntegrationDateRange(
  crashDateOffset?: string,
  numDays?: number,
  configNumDays?: string,
): { startDateISO: string; endDateISO: string; startDateDDMMYYYY: string; endDateDDMMYYYY: string; offset: number; resolvedNumDays: number } {
  const offset = parseInt(crashDateOffset ?? "4", 10);
  let n = numDays ?? parseInt(configNumDays ?? "1", 10);
  n = Math.max(1, Math.min(n, 180));
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - offset);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - n + 1);
  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  const toDDMMYYYY = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}-${mm}-${d.getFullYear()}`;
  };
  return {
    startDateISO: toISO(startDate),
    endDateISO: toISO(endDate),
    startDateDDMMYYYY: toDDMMYYYY(startDate),
    endDateDDMMYYYY: toDDMMYYYY(endDate),
    offset,
    resolvedNumDays: n,
  };
}

// ── Tool: save_apptics_crashes ────────────────────────────────────────────────
server.registerTool(
  "save_apptics_crashes",
  {
    description:
      "Save crash data fetched by Claude from the Apptics Zoho MCP as .crash files in MainCrashLogsFolder/AppticsCrashLogs/. Call this BEFORE run_full_pipeline so the pipeline can process Apptics crashes alongside Xcode crashes. Uses UniqueMessageID in filenames for idempotency.",
    inputSchema: z.object({
      crashes: z.array(z.object({
        UniqueMessageID: z.string().describe("Unique crash identifier from Apptics"),
        Exception: z.string().optional().describe("Exception type string"),
        CrashCount: z.string().optional().describe("Number of crash occurrences"),
        DevicesCount: z.string().optional().describe("Number of affected devices"),
        UsersCount: z.string().optional().describe("Number of affected users"),
        AppVersion: z.string().optional().describe("App version string"),
        OS: z.string().optional().describe("Operating system name"),
        Message: z.string().optional().describe("Full crash report text with stack trace from getCrashSummaryWithUniqueMessageId. Used as primary crash file content when present."),
        IssueName: z.string().optional().describe("Apptics issue name"),
        Model: z.string().optional().describe("Device model"),
        OSVersion: z.string().optional().describe("OS version string"),
        date: z.string().optional().describe("Date/time of the crash"),
        CrashDesc: z.string().optional().describe("Crash description"),
        AppReleaseVersion: z.string().optional().describe("App release/build version"),
        DeviceID: z.string().optional().describe("Device identifier"),
        NetworkStatus: z.string().optional().describe("Network status at crash time"),
        BatteryStatus: z.string().optional().describe("Battery status at crash time"),
        Edge: z.string().optional().describe("Edge/connectivity info"),
        Orientation: z.string().optional().describe("Device orientation"),
      })).describe("Array of crash entries fetched from the Apptics Zoho MCP"),
      clearExisting: z.boolean().optional().describe("When true (default), remove all existing .crash files from AppticsCrashLogs/ before saving new ones."),
    }),
    outputSchema: z.object({
      saved: z.number(),
      outputDir: z.string(),
      files: z.array(z.string()),
    }),
  },
  async (input) => {
    const config = getConfig();
    const outputDir = getAppticsCrashesDir(config);
    const clearExisting = input.clearExisting ?? true;

    fs.mkdirSync(outputDir, { recursive: true });

    if (clearExisting) {
      const existing = fs.readdirSync(outputDir).filter((f) => f.endsWith(".crash"));
      for (const f of existing) fs.unlinkSync(path.join(outputDir, f));
    }

    // Collect existing UniqueMessageIDs for idempotency when clearExisting=false
    const existingIDs = new Set<string>();
    if (!clearExisting) {
      for (const f of fs.readdirSync(outputDir).filter((f) => f.endsWith(".crash"))) {
        const match = f.match(/^AppticsCrash_(.+)\.crash$/);
        if (match) existingIDs.add(match[1]);
      }
    }

    const savedFiles: string[] = [];
    for (const crash of input.crashes) {
      if (existingIDs.has(crash.UniqueMessageID)) continue;

      let content: string;
      if (crash.Message) {
        content = crash.Message;
      } else {
        const entry: AppticsCrashEntry = {
          UniqueMessageID: crash.UniqueMessageID,
          Exception: crash.Exception ?? "",
          CrashCount: crash.CrashCount ?? "",
          DevicesCount: crash.DevicesCount ?? "",
          UsersCount: crash.UsersCount ?? "",
          AppVersion: crash.AppVersion ?? "",
          OS: crash.OS ?? "",
          Status: 0,
          PID: 0,
          AppVersionID: 0,
        };
        const detail: AppticsCrashDetail = {
          UniqueMessageID: crash.UniqueMessageID,
          IssueName: crash.IssueName,
          Model: crash.Model,
          OSVersion: crash.OSVersion,
          date: crash.date,
          AppReleaseVersion: crash.AppReleaseVersion,
          DeviceID: crash.DeviceID,
          NetworkStatus: crash.NetworkStatus,
          BatteryStatus: crash.BatteryStatus,
          Edge: crash.Edge,
          AppVersion: crash.AppVersion,
          OS: crash.OS,
        };
        content = formatCrashFile(detail, entry);
      }

      const fileName = `AppticsCrash_${crash.UniqueMessageID}.crash`;
      const filePath = path.join(outputDir, fileName);
      fs.writeFileSync(filePath, content, "utf-8");
      savedFiles.push(fileName);
    }

    const result = { saved: savedFiles.length, outputDir, files: savedFiles };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool: run_full_pipeline ───────────────────────────────────────────────────
server.registerTool(
  "run_full_pipeline",
  {
    description:
      "Run the full CrashPoint pipeline: export crash logs → symbolicate → analyze. Returns analysis results plus a nextSteps object indicating required follow-up actions (notifyCliq, reportToProjects). After this tool completes, follow nextSteps: call notify_cliq if notifyCliq is true; call prepare_project_bugs and then use the Apptics MCP's Zoho Projects tools if reportToProjects is true. Dates are computed automatically from CRASH_DATE_OFFSET and numDays config.",
    inputSchema: z.object({
      notifyCliq: z.boolean().optional().describe("When true, send a notification to Zoho Cliq after analysis. Default false."),
      reportToProjects: z.boolean().optional().describe("When true, create/update Zoho Projects bugs after analysis. Default false."),
      unfixedOnly: z.boolean().optional().describe("When true, only include unfixed crash groups in notifications/reports."),
      versions: z.string().optional().describe("Comma-separated version filter for crash export."),
      numDays: z.number().optional().describe("Number of days to process (1–180). End = today minus CRASH_DATE_OFFSET, start = end minus numDays + 1. Overrides CRASH_NUM_DAYS in config."),
      dryRun: z.boolean().optional().describe("When true, no side effects — dry-run for all stages."),
      skipDownload: z.boolean().optional().describe("When true, skip the Apptics crash download check and only run export/symbolicate/analyze on existing files. Default false."),
      expectedCrashCount: z.number().optional().describe("Expected number of Apptics crash files. If provided, the pipeline will warn if the actual count doesn't match."),
    }),
    outputSchema: z.object({
      dateRange: z.any().optional(),
      appticsDownload: z.any().optional(),
      export: z.any().optional(),
      symbolicate: z.any().optional(),
      analyze: z.any().optional(),
      csv: z.any().optional(),
      nextSteps: z.any().optional(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const parentDir = config.CRASH_ANALYSIS_PARENT;
    const dsymPath = config.DSYM_PATH;
    const analyzedDir = getAnalyzedReportsDir(config);
    fs.mkdirSync(analyzedDir, { recursive: true });
    const ts = Date.now();
    const newReportPath = path.join(analyzedDir, `jsonReport_${ts}.json`);

    const summary: Record<string, unknown> = {};

    // ── Step 0: Compute date range ─────────────────────────────────────────
    const dateRange = computeIntegrationDateRange(config.CRASH_DATE_OFFSET, input.numDays, config.CRASH_NUM_DAYS);
    summary.dateRange = {
      startDate: dateRange.startDateISO,
      endDate: dateRange.endDateISO,
      offset: dateRange.offset,
      numDays: dateRange.resolvedNumDays,
    };

    // ── Step 1: Apptics crash check ────────────────────────────────────────
    const appticsDir = getAppticsCrashesDir(config);
    const hasAppticsFiles = fs.existsSync(appticsDir) && fs.readdirSync(appticsDir).some((f) => f.endsWith(".crash"));

    if (input.skipDownload) {
      summary.appticsDownload = { skipped: true, reason: "skipDownload flag set by caller" };
    } else {
      const crashFileCount = hasAppticsFiles
        ? fs.readdirSync(appticsDir).filter((f) => f.endsWith(".crash")).length
        : 0;
      summary.appticsDownload = {
        source: "external (Apptics MCP via Claude)",
        filesFound: hasAppticsFiles,
        crashFileCount,
        note: hasAppticsFiles
          ? "Apptics crash files found in AppticsCrashLogs/"
          : "No Apptics crash files found in AppticsCrashLogs/. Ensure Claude called save_apptics_crashes before run_full_pipeline.",
      };
      if (input.expectedCrashCount !== undefined && crashFileCount !== input.expectedCrashCount) {
        (summary.appticsDownload as Record<string, unknown>).warning =
          `Expected ${input.expectedCrashCount} crash files but found ${crashFileCount}. Some crash files may have been lost during save.`;
      }
    }

    // ── Step 2: Export ─────────────────────────────────────────────────────
    const exportManifest = new ProcessedManifest(parentDir, "export");
    const symbolicateManifest = new ProcessedManifest(parentDir, "symbolicate");
    const analyzeManifest = new ProcessedManifest(parentDir, "analyze");

    try {
      const versionList = input.versions ? input.versions.split(",").map((v) => v.trim()) : undefined;
      const exportOutputDir = getXcodeCrashesDir(config);
      const exportResult = exportCrashLogs(
        parentDir,
        exportOutputDir,
        versionList,
        false,
        input.dryRun ?? false,
        dateRange.startDateISO,
        dateRange.endDateISO,
        exportManifest,
      );
      summary.export = exportResult;
    } catch (err) {
      summary.export = { error: err instanceof Error ? err.message : String(err) };
    }

    // ── Step 3: Symbolicate ────────────────────────────────────────────────
    const symbolicatedDir = getSymbolicatedDir(config);
    if (dsymPath) {
      try {
        const batchResult = await runBatchAll(dsymPath, symbolicateManifest);
        summary.symbolicate = batchResult;
      } catch (err) {
        summary.symbolicate = { error: err instanceof Error ? err.message : String(err) };
      }
    } else {
      summary.symbolicate = { skipped: true, reason: "DSYM_PATH not configured" };
    }

    // ── Step 4: Analyze ────────────────────────────────────────────────────
    let report: CrashReport | undefined;
    try {
      const fixStatuses = loadFixStatuses(getStateMaintenanceDir(config));
      report = analyzeDirectory(symbolicatedDir, fixStatuses, analyzeManifest);

      if (!input.dryRun) {
        fs.writeFileSync(newReportPath, JSON.stringify(report, null, 2), "utf-8");
        summary.analyze = { crashGroups: report.crash_groups?.length ?? 0, reportPath: newReportPath };

        const csvPath = newReportPath.replace(/\.json$/, ".csv");
        exportReportToCsv(report, csvPath);
        summary.csv = { path: csvPath };

        const latestJsonPath = path.join(analyzedDir, "latest.json");
        const latestCsvPath = path.join(analyzedDir, "latest.csv");
        try {
          try { fs.rmSync(latestJsonPath, { force: true }); } catch {}
          try { fs.rmSync(latestCsvPath, { force: true }); } catch {}
          fs.copyFileSync(newReportPath, latestJsonPath);
          fs.copyFileSync(csvPath, latestCsvPath);
        } catch (copyErr) {
          summary.latestPointers = { error: copyErr instanceof Error ? copyErr.message : String(copyErr) };
        }
      } else {
        summary.analyze = { dryRun: true, crashGroups: report.crash_groups?.length ?? 0 };
      }
    } catch (err) {
      summary.analyze = { error: err instanceof Error ? err.message : String(err) };
    }

    // ── Next Steps ─────────────────────────────────────────────────────────
    const crashGroups = report?.crash_groups?.length ?? 0;

    if (crashGroups === 0) {
      const xcodeCrashesDir = getXcodeCrashesDir(config);
      const hasCrashes =
        (fs.existsSync(appticsDir) && fs.readdirSync(appticsDir).some((f) => f.endsWith(".crash"))) ||
        (fs.existsSync(xcodeCrashesDir) && fs.readdirSync(xcodeCrashesDir).some((f) => f.endsWith(".crash")));
      if (hasCrashes) {
        (summary as Record<string, unknown>).warning =
          "0 crash groups found but crash files exist in input directories. Check if crash files are valid and properly formatted.";
      }
    }

    summary.nextSteps = {
      notifyCliq: input.notifyCliq === true && crashGroups > 0,
      reportToProjects: input.reportToProjects === true && crashGroups > 0,
      reportPath: !input.dryRun ? newReportPath : undefined,
      crashGroups,
      apptics: {
        portalId: config.APPTICS_PORTAL_ID,
        projectId: config.APPTICS_PROJECT_ID,
        appName: config.APPTICS_APP_NAME ?? config.APP_DISPLAY_NAME,
      },
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool: notify_cliq ─────────────────────────────────────────────────────────
server.registerTool(
  "notify_cliq",
  {
    description:
      "Send a crash analysis report summary to a Zoho Cliq channel via incoming webhook. Reads the existing report from the AnalyzedReportsFolder. IMPORTANT: The message format is pre-defined by the server. Do NOT modify, reformat, or restructure the Cliq message content.",
    inputSchema: z.object({
      reportPath: z.string().optional().describe("Path to the report JSON file. Defaults to latest.json in AnalyzedReportsFolder."),
      unfixedOnly: z.boolean().optional().describe("When true, only include crash groups that are NOT marked as fixed."),
      dryRun: z.boolean().optional().describe("When true, show the message that would be sent without actually posting to Cliq."),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
      messagePreview: z.any().optional(),
      cliqResponse: z.string().optional(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const resolvedPath = input.reportPath ?? findLatestReport(getAnalyzedReportsDir(config));

    const rawReport = JSON.parse(fs.readFileSync(resolvedPath, "utf-8")) as CrashReport;
    let report = rawReport;
    if (input.unfixedOnly) report = filterUnfixedGroups(rawReport).filtered;

    const groups: CrashGroup[] = report.crash_groups ?? [];

    if (groups.length === 0) {
      const result = { success: true, message: "No crash groups to report." };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    const message = buildCliqMessage(report, groups);

    if (input.dryRun) {
      const result = { success: true, message: "Dry run — message not sent.", messagePreview: message };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    if (!config.ZOHO_CLIQ_WEBHOOK_URL) {
      const result = { success: false, message: "ZOHO_CLIQ_WEBHOOK_URL is not configured." };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    const response = await fetch(config.ZOHO_CLIQ_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    const cliqResponse = await response.text();
    const result = {
      success: response.ok,
      message: response.ok
        ? `Cliq notification sent (HTTP ${response.status}).`
        : `Failed to send Cliq notification (HTTP ${response.status}).`,
      cliqResponse,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool: prepare_project_bugs ────────────────────────────────────────────────
server.registerTool(
  "prepare_project_bugs",
  {
    description:
      "Prepare structured bug data from a crash analysis report for Claude to submit to Zoho Projects. Returns bug records with pre-computed field values (title, description, severity, custom fields) plus step-by-step instructions for using the Apptics MCP's Zoho Projects tools.",
    inputSchema: z.object({
      reportPath: z.string().optional().describe("Path to the report JSON file. Defaults to latest.json in AnalyzedReportsFolder."),
      unfixedOnly: z.boolean().optional().describe("When true, only include crash groups NOT marked as fixed."),
      dryRun: z.boolean().optional().describe("When true, show what would be prepared without reading the full report (summary only)."),
    }),
    outputSchema: z.object({
      reportDate: z.string(),
      reportPath: z.string(),
      totalGroups: z.number(),
      bugs: z.array(z.any()).optional(),
      projectConfig: z.any().optional(),
      instructions: z.string().optional(),
      dryRun: z.boolean().optional(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const resolvedPath = input.reportPath ?? findLatestReport(getAnalyzedReportsDir(config));

    const rawReport = JSON.parse(fs.readFileSync(resolvedPath, "utf-8")) as CrashReport;
    let report = rawReport;
    if (input.unfixedOnly) report = filterUnfixedGroups(rawReport).filtered;

    const groups: CrashGroup[] = report.crash_groups ?? [];
    const reportDate = rawReport.report_date
      ? new Date(rawReport.report_date).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    const projectConfig = {
      portalId: config.ZOHO_PROJECTS_PORTAL_ID,
      projectId: config.ZOHO_PROJECTS_PROJECT_ID,
      appVersionField: config.ZOHO_BUG_APP_VERSION,
      occurrencesField: config.ZOHO_BUG_NUM_OF_OCCURRENCES,
    };

    if (input.dryRun) {
      const bugs = groups.map((group) => ({
        signature: group.signature,
        title: buildBugTitle(group),
        severityId: getSeverityId(config, group.count ?? 1),
      }));
      const result = { reportDate, reportPath: resolvedPath, totalGroups: groups.length, dryRun: true, bugs, projectConfig };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    const bugs = groups.map((group) => {
      const title = buildBugTitle(group);
      const description = buildBugDescription(group, group.count ?? 1, [reportDate]);
      const severityId = getSeverityId(config, group.count ?? 1);
      const appVersion = config.CRASH_VERSIONS ? stripBuildNumber(config.CRASH_VERSIONS) : undefined;
      return {
        signature: group.signature,
        title,
        description,
        severityId,
        statusId: config.ZOHO_BUG_STATUS_OPEN,
        appVersion,
        occurrences: group.count ?? 1,
        searchPrefix: `[CrashPoint] ${group.exception_type}`,
      };
    });

    const result = {
      reportDate,
      reportPath: resolvedPath,
      totalGroups: groups.length,
      bugs,
      projectConfig,
      instructions: "For each bug: 1) Call list_bugs with portal_id and project_id to check for existing bugs with matching searchPrefix in the title. 2) If found, call update_bug to increment occurrences and append the crash date. 3) If not found, call create_bug with all fields (title, description, severity_id, status_id, and custom fields for appVersion and occurrences).",
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool: setup_automation_files ──────────────────────────────────────────────
server.registerTool(
  "setup_automation_files",
  {
    description:
      "Scaffold the automation pipeline scripts (run_crash_pipeline.sh, daily_crash_pipeline_prompt_phase1.md, and daily_crash_pipeline_prompt_phase2.md) into the Automation/ folder of your ParentHolderFolder. Use force=true to update existing files to the latest version.",
    inputSchema: z.object({
      force: z.boolean().optional().describe("When true, overwrite existing automation files with the latest version. Default false (skip existing files)."),
    }),
    outputSchema: z.object({
      automationDir: z.string(),
      scaffolded: z.array(z.string()),
      skipped: z.array(z.string()),
      force: z.boolean(),
    }),
  },
  async (input) => {
    const { setupAutomationFiles: scaffoldFiles } = await import("./core/setupAutomation.js");
    const config = getConfig();
    const parentDir = config.CRASH_ANALYSIS_PARENT;
    // __dirname is injected by esbuild banner (points to dist/ directory)
    // Package root is one level up from dist/
    const packageRoot = path.resolve(__dirname, "..");
    const result = scaffoldFiles({ force: input.force ?? false, packageRoot, parentDir });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool: cleanup_all ─────────────────────────────────────────────────────────
server.registerTool(
  "cleanup_all",
  {
    description:
      "Remove all crash files and reports in one go. Cleans .crash and .ips files from XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs, and SymbolicatedCrashLogsFolder. Also cleans .json/.csv report files from AnalyzedReportsFolder and processed manifests from StateMaintenance. Use dryRun to preview, keepReports to preserve report files, keepManifests to preserve processed manifests.",
    inputSchema: z.object({
      dryRun: z.boolean().optional().describe("When true, list what would be deleted without actually deleting."),
      keepReports: z.boolean().optional().describe("When true, preserve report files in AnalyzedReportsFolder (only clean crash files)."),
      keepManifests: z.boolean().optional().describe("When true, preserve processed manifests in StateMaintenance."),
    }),
    outputSchema: z.object({
      dryRun: z.boolean(),
      deleted: z.object({
        xcodeCrashLogs: z.number(),
        appticsCrashLogs: z.number(),
        otherCrashLogs: z.number(),
        symbolicatedCrashLogs: z.number(),
        analyzedReports: z.number(),
        stateManifests: z.number(),
      }),
      totalDeleted: z.number(),
      files: z.array(z.string()),
    }),
  },
  async (input) => {
    const config = getConfig();
    const dryRun = input.dryRun ?? false;
    const keepReports = input.keepReports ?? false;
    const keepManifests = input.keepManifests ?? false;

    const counts = {
      xcodeCrashLogs: 0,
      appticsCrashLogs: 0,
      otherCrashLogs: 0,
      symbolicatedCrashLogs: 0,
      analyzedReports: 0,
      stateManifests: 0,
    };
    const deletedFiles: string[] = [];

    function cleanDir(dir: string, extensions: string[], countKey: keyof typeof counts): void {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir).filter((f) => extensions.some((ext) => f.endsWith(ext)));
      for (const f of files) {
        const fullPath = path.join(dir, f);
        deletedFiles.push(fullPath);
        counts[countKey]++;
        if (!dryRun) fs.unlinkSync(fullPath);
      }
    }

    cleanDir(getXcodeCrashesDir(config), [".crash", ".ips"], "xcodeCrashLogs");
    cleanDir(getAppticsCrashesDir(config), [".crash", ".ips"], "appticsCrashLogs");
    cleanDir(getOtherCrashesDir(config), [".crash", ".ips"], "otherCrashLogs");
    cleanDir(getSymbolicatedDir(config), [".crash", ".ips"], "symbolicatedCrashLogs");

    if (!keepReports) {
      const reportsDir = getAnalyzedReportsDir(config);
      if (fs.existsSync(reportsDir)) {
        const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith(".json") || f.endsWith(".csv"));
        for (const f of files) {
          const fullPath = path.join(reportsDir, f);
          deletedFiles.push(fullPath);
          counts.analyzedReports++;
          if (!dryRun) fs.unlinkSync(fullPath);
        }
      }
    }

    if (!keepManifests) {
      const stateDir = getStateMaintenanceDir(config);
      if (fs.existsSync(stateDir)) {
        const files = fs.readdirSync(stateDir).filter((f) => f.endsWith(".json"));
        for (const f of files) {
          const fullPath = path.join(stateDir, f);
          deletedFiles.push(fullPath);
          counts.stateManifests++;
          if (!dryRun) fs.unlinkSync(fullPath);
        }
      }
    }

    const totalDeleted = Object.values(counts).reduce((s, n) => s + n, 0);
    const result = { dryRun, deleted: counts, totalDeleted, files: deletedFiles };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Bootstrap ────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();
