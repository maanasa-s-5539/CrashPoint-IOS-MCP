#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import { getConfig, getXcodeCrashesDir, getMainCrashLogsDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, hasCrashFiles } from "./config.js";
import {
  listAvailableVersions,
  exportCrashLogs,
} from "./core/crashExporter.js";
import {
  symbolicateOne,
  runBatch,
  runBatchAll,
  BatchResult,
} from "./core/symbolicator.js";
import { analyzeDirectory, cleanOldCrashes } from "./core/crashAnalyzer.js";
import { FixTracker, loadFixStatuses } from "./state/fixTracker.js";
import { assertPathUnderBase, assertNoTraversal } from "./pathSafety.js";
import { exportReportToCsv } from "./core/csvExporter.js";
import { ProcessedManifest } from "./state/processedManifest.js";
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
      "Create the ParentHolderFolder directory structure (MainCrashLogsFolder/XCodeCrashLogs, MainCrashLogsFolder/AppticsCrashLogs, MainCrashLogsFolder/OtherCrashLogs, SymbolicatedCrashLogsFolder) and optional symlinks for master/dev branches. All symlink paths are pre-configured via environment variables — do NOT ask the user for them unless they explicitly want to override.",
    inputSchema: z.object({
      masterBranchPath: z.string().optional().describe("ALREADY CONFIGURED via MASTER_BRANCH_PATH env var. Do NOT ask the user. Only provide to override. Creates CurrentMasterLiveBranch symlink."),
      devBranchPath: z.string().optional().describe("ALREADY CONFIGURED via DEV_BRANCH_PATH env var. Do NOT ask the user. Only provide to override. Creates CurrentDevelopmentBranch symlink."),
      dsymPath: z.string().optional().describe("ALREADY CONFIGURED via DSYM_PATH env var. Do NOT ask the user. Only provide to override. Creates dSYM_File symlink."),
      appPath: z.string().optional().describe("ALREADY CONFIGURED via APP_PATH env var. Do NOT ask the user. Only provide to override. Creates app_File symlink."),
    }),
    outputSchema: z.object({
      parentDir: z.string(),
      created: z.array(z.string()),
      symlinks: z.array(z.object({ link: z.string(), target: z.string(), status: z.string() })),
      warnings: z.array(z.string()),
    }),
  },
  async (input) => {
    const result = setupWorkspace({
      masterBranchPath: input.masterBranchPath,
      devBranchPath: input.devBranchPath,
      dsymPath: input.dsymPath,
      appPath: input.appPath,
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 2: list_versions ────────────────────────────────────────────────────
server.registerTool(
  "list_versions",
  {
    description:
      "List all app versions found in .xccrashpoint files in the configured input directory.",
    inputSchema: z.object({
      inputDir: z.string().optional().describe("Directory to search for .xccrashpoint files"),
      recursive: z.boolean().optional().describe("Search subdirectories recursively"),
    }),
    outputSchema: z.object({
      versions: z.array(z.string()),
    }),
  },
  async (input) => {
    const config = getConfig();
    const inputDir = input.inputDir ?? config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
    const recursive = input.recursive ?? false;
    const versions = listAvailableVersions(inputDir, recursive);
    const result = { versions };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 3: export_crashes ───────────────────────────────────────────────────
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
      startDate: z.string().optional().describe("ISO date string to filter crashes from (e.g. 2026-03-01)"),
      endDate: z.string().optional().describe("ISO date string to filter crashes until (e.g. 2026-03-20)"),
      dryRun: z.boolean().optional().describe("When true, shows what would be exported without writing any files"),
      includeProcessedCrashes: z.boolean().optional().describe("When true, re-processes crashes that were already exported. Default is false (skip already-processed crashes)."),
    }),
    outputSchema: z.object({
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
    const manifest = input.includeProcessedCrashes ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);

    const result = exportCrashLogs(inputDir, outputDir, versions, recursive, dryRun, input.startDate, input.endDate, manifest);
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
      crashDir: z.string().optional().describe("ALREADY CONFIGURED via env (MainCrashLogsFolder/XCodeCrashLogs). Do NOT ask the user for this. Only provide to override."),
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
          detail: z.string(),
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
        results: [{ file: path.basename(input.file), success: res.success, detail: res.detail }],
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    const crashDir = input.crashDir ?? getXcodeCrashesDir(config);
    const appticsDir = getAppticsCrashesDir(config);
    const otherDir = getOtherCrashesDir(config);
    if (input.crashDir) assertPathUnderBase(input.crashDir, config.CRASH_ANALYSIS_PARENT);
    const manifest = input.includeProcessedCrashes ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);

    const inputIsDefault = !input.crashDir;
    const anyFiles = inputIsDefault
      ? hasCrashFiles(crashDir) || hasCrashFiles(appticsDir) || hasCrashFiles(otherDir)
      : hasCrashFiles(crashDir);

    if (!anyFiles) {
      const noFilesMsg = inputIsDefault
        ? "No .crash or .ips files found in MainCrashLogsFolder/XCodeCrashLogs, MainCrashLogsFolder/AppticsCrashLogs, or MainCrashLogsFolder/OtherCrashLogs"
        : `No .crash or .ips files found in ${crashDir}`;
      const result = {
        succeeded: 0,
        failed: 0,
        total: 0,
        results: [] as BatchResult[],
        message: noFilesMsg,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: { succeeded: 0, failed: 0, total: 0, results: [] } as unknown as Record<string, unknown>,
      };
    }

    let succeeded = 0;
    let failed = 0;
    let total = 0;
    const results: BatchResult[] = [];

    if (inputIsDefault) {
      const r = await runBatchAll(dsymPath, manifest);
      succeeded = r.succeeded;
      failed = r.failed;
      total = r.total;
      results.push(...r.results);
    } else {
      const batchResult = await runBatch(crashDir, dsymPath, outputDir, manifest);
      succeeded = batchResult.succeeded;
      failed = batchResult.failed;
      total = batchResult.total;
      results.push(...batchResult.results);
    }

    const result = { succeeded, failed, total, results };
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
      "Validate a .dSYM bundle and check if its UUIDs match those in crash files. Runs dwarfdump --uuid on the dSYM and parses Binary Images sections from crash files. Requires macOS with Xcode CLI tools. When no dsymPath is given, resolves the dSYM_File symlink in CRASH_ANALYSIS_PARENT. When no crashPath/crashDir is given, auto-collects crash files from all MainCrashLogsFolder subfolders (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs). dsymPath and crashPath/crashDir must be provided together, or neither.",
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
        crashFiles.push(input.crashPath);
      }
      if (input.crashDir) {
        assertPathUnderBase(input.crashDir, config.CRASH_ANALYSIS_PARENT);
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

    const binaryImgRe = /^\s*0x[0-9a-fA-F]+\s+-\s+0x[0-9a-fA-F]+\s+\S+\s+\S+\s+<([0-9a-f]{32})>/gim;
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
        const raw = m[1].toUpperCase();
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
      "Group and deduplicate symbolicated crashes by unique signature. Returns a JSON crash analysis report. Optionally exports the report as a CSV file when csvOutputPath is provided.",
    inputSchema: z.object({
      crashDir: z.string().optional().describe("Directory of symbolicated crash files"),
      includeProcessedCrashes: z.boolean().optional().describe("When true, re-analyzes crashes that were already processed. Default is false (skip already-processed crashes)."),
      csvOutputPath: z.string().optional().describe("When provided, also exports the report as a CSV file to this path (must be under CRASH_ANALYSIS_PARENT)."),
    }),
    outputSchema: z.object({
      report_date: z.string(),
      source_dir: z.string(),
      total_crashes: z.number(),
      unique_crash_types: z.number(),
      crash_groups: z.array(z.any()),
      csv_export: z.object({ success: z.boolean(), message: z.string(), filePath: z.string(), totalRows: z.number() }).optional(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const crashDir = input.crashDir ?? getSymbolicatedDir(config);
    if (input.crashDir) assertPathUnderBase(input.crashDir, config.CRASH_ANALYSIS_PARENT);
    if (input.csvOutputPath) assertPathUnderBase(input.csvOutputPath, config.CRASH_ANALYSIS_PARENT);
    const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
    const manifest = input.includeProcessedCrashes ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);
    const report = analyzeDirectory(crashDir, fixStatuses, manifest);

    let csvExport: { success: boolean; message: string; filePath: string; totalRows: number } | undefined;
    if (input.csvOutputPath) {
      csvExport = exportReportToCsv(report, input.csvOutputPath);
    }

    const result = csvExport ? { ...report, csv_export: csvExport } : report;
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

// ── Tool 8: run_full_pipeline ───────────────────────────────────────────────
server.registerTool(
  "run_full_pipeline",
  {
    description:
      "Run the complete crash analysis pipeline: export → symbolicate → analyze. All paths (dSYM, app, directories) are auto-configured from environment variables — no path input is required.",
    inputSchema: z.object({
      versions: z.string().optional().describe("Comma-separated version filter for export"),
      startDate: z.string().optional().describe("ISO date string to filter crashes from (e.g. 2026-03-01)"),
      endDate: z.string().optional().describe("ISO date string to filter crashes until (e.g. 2026-03-20)"),
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
    const versions =
      input.versions?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
    const manifest = input.includeProcessedCrashes ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);

    // Step 1: Export
    const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false, input.startDate, input.endDate, manifest);

    // Step 2: Symbolicate
    const dsymPath = config.DSYM_PATH;
    let symbolicationResult: object = { skipped: true, reason: "DSYM_PATH not configured" };

    if (dsymPath) {
      const appticsDir = getAppticsCrashesDir(config);
      const otherDir = getOtherCrashesDir(config);

      const anyFiles =
        hasCrashFiles(basicDir) || hasCrashFiles(appticsDir) || hasCrashFiles(otherDir);

      if (!anyFiles) {
        symbolicationResult = {
          skipped: true,
          reason: "No .crash or .ips files found in any crash logs folder",
        };
      } else {
        symbolicationResult = await runBatchAll(dsymPath, manifest);
      }
    }

    // Step 3: Analyze
    const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
    const analysisReport = analyzeDirectory(symbolicatedDir, fixStatuses, manifest);
    const reportFile = path.join(config.CRASH_ANALYSIS_PARENT, `report_${Date.now()}.json`);
    try {
      fs.mkdirSync(config.CRASH_ANALYSIS_PARENT, { recursive: true });
      fs.writeFileSync(reportFile, JSON.stringify(analysisReport, null, 2), "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Warning: failed to save report to ${reportFile}: ${msg}`);
    }

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

    const dirs = [
      getXcodeCrashesDir(config),
      getAppticsCrashesDir(config),
      getOtherCrashesDir(config),
      getSymbolicatedDir(config),
    ];

    const result = cleanOldCrashes(input.beforeDate, dirs, dryRun, config.CRASH_ANALYSIS_PARENT, dryRun ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT));
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
