#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";

import { getConfig, getXcodeCrashesDir, getMainCrashLogsDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, hasCrashFiles } from "./config.js";
import {
  listAvailableVersions,
  exportCrashLogs,
} from "./crashExporter.js";
import {
  symbolicateOne,
  runBatch,
  diagnoseFrames,
  BatchResult,
} from "./symbolicator.js";
import { analyzeDirectory } from "./crashAnalyzer.js";
import { sendCrashReportToCliq } from "./cliqNotifier.js";
import { FixTracker } from "./fixTracker.js";
import { assertPathUnderBase, assertNoTraversal, assertSafeSymlinkTarget } from "./pathSafety.js";
import { reportToZohoProjectsViaMcp, getFieldIdsFromConfig } from "./zohoProjectsMcpBridge.js";

const server = new McpServer({
  name: "crashpoint-ios-mcp",
  version: "1.0.0",
});

// ── Tool 1: list_versions ────────────────────────────────────────────────────
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
      structuredContent: result,
    };
  }
);

// ── Tool 2: preview_export ───────────────────────────────────────────────────
server.registerTool(
  "preview_export",
  {
    description:
      "Dry-run preview of crash log export. Shows what files would be exported without writing anything.",
    inputSchema: z.object({
      inputDir: z.string().optional().describe("Directory to search for .xccrashpoint files"),
      outputDir: z.string().optional().describe("Destination directory for crash logs"),
      versions: z.string().optional().describe("Comma-separated version filter"),
      recursive: z.boolean().optional().describe("Search subdirectories recursively"),
      startDate: z.string().optional().describe("ISO date string to filter crashes from (e.g. 2026-03-01)"),
      endDate: z.string().optional().describe("ISO date string to filter crashes until (e.g. 2026-03-20)"),
    }),
    outputSchema: z.object({
      would_export: z.number(),
      would_skip: z.number(),
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

    const result = exportCrashLogs(inputDir, outputDir, versions, recursive, true, input.startDate, input.endDate);
    const structured = {
      would_export: result.exported,
      would_skip: result.skipped,
      files: result.files,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(structured, null, 2) }],
      structuredContent: structured,
    };
  }
);

// ── Tool 3: export_crashes ───────────────────────────────────────────────────
server.registerTool(
  "export_crashes",
  {
    description:
      "Export .crash files from .xccrashpoint packages into MainCrashLogsFolder/XCodeCrashLogs.",
    inputSchema: z.object({
      inputDir: z.string().optional().describe("Directory to search for .xccrashpoint files"),
      outputDir: z.string().optional().describe("Destination directory for crash logs"),
      versions: z.string().optional().describe("Comma-separated version filter"),
      recursive: z.boolean().optional().describe("Search subdirectories recursively"),
      startDate: z.string().optional().describe("ISO date string to filter crashes from (e.g. 2026-03-01)"),
      endDate: z.string().optional().describe("ISO date string to filter crashes until (e.g. 2026-03-20)"),
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

    const result = exportCrashLogs(inputDir, outputDir, versions, recursive, false, input.startDate, input.endDate);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Tool 4: symbolicate_one ──────────────────────────────────────────────────
server.registerTool(
  "symbolicate_one",
  {
    description:
      "Symbolicate a single .crash file using atos. Requires macOS with Xcode CLI tools. dsymPath and appPath are pre-configured via environment variables — do NOT ask the user for them unless they explicitly want to override.",
    inputSchema: z.object({
      crashPath: z.string().describe("Path to the .crash or .ips file"),
      dsymPath: z.string().optional().describe("ALREADY CONFIGURED via DSYM_PATH env var. Do NOT ask the user for this. Only provide if the user explicitly wants to override the configured default."),
      appPath: z.string().optional().describe("ALREADY CONFIGURED via APP_PATH env var. Do NOT ask the user for this. Only provide if the user explicitly wants to override the configured default."),
      outputPath: z.string().optional().describe("Where to write the symbolicated file"),
      arch: z.string().optional().describe("Architecture override (e.g. arm64)"),
      allThreads: z.boolean().optional().describe("Symbolicate all threads (default: crashed thread only)"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      detail: z.string(),
      symbolicatedCount: z.number(),
      totalAppFrames: z.number(),
    }),
  },
  async (input) => {
    const config = getConfig();
    assertNoTraversal(input.crashPath);
    const dsymPath = input.dsymPath ?? config.DSYM_PATH;
    const appPath = input.appPath ?? config.APP_PATH;
    if (input.dsymPath) assertNoTraversal(input.dsymPath);
    if (input.appPath) assertNoTraversal(input.appPath);

    if (!dsymPath) {
      const result = {
        success: false,
        detail: "dsymPath not provided and DSYM_PATH env var not set.",
        symbolicatedCount: 0,
        totalAppFrames: 0,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }

    const outputPath =
      input.outputPath ??
      path.join(
        getSymbolicatedDir(config),
        path.basename(input.crashPath)
      );

    const result = await symbolicateOne(
      input.crashPath,
      dsymPath,
      appPath,
      outputPath,
      input.arch,
      input.allThreads ?? false
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Tool 5: symbolicate_batch ────────────────────────────────────────────────
server.registerTool(
  "symbolicate_batch",
  {
    description:
      "Symbolicate ALL .crash and .ips files in MainCrashLogsFolder (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs), output to SymbolicatedCrashLogsFolder. All paths (dSYM, app, crash directory, output directory) are pre-configured via environment variables — do NOT ask the user for them unless they explicitly want to override.",
    inputSchema: z.object({
      crashDir: z.string().optional().describe("ALREADY CONFIGURED via env (MainCrashLogsFolder/XCodeCrashLogs). Do NOT ask the user for this. Only provide to override."),
      dsymPath: z.string().optional().describe("ALREADY CONFIGURED via DSYM_PATH env var. Do NOT ask the user for this. Only provide if the user explicitly wants to override the configured default."),
      appPath: z.string().optional().describe("ALREADY CONFIGURED via APP_PATH env var. Do NOT ask the user for this. Only provide if the user explicitly wants to override the configured default."),
      outputDir: z.string().optional().describe("ALREADY CONFIGURED via env (SymbolicatedCrashLogsFolder). Do NOT ask the user for this. Only provide to override."),
      arch: z.string().optional().describe("Architecture override"),
      allThreads: z.boolean().optional().describe("Symbolicate all threads"),
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
          symbolicatedCount: z.number(),
          totalAppFrames: z.number(),
        })
      ),
    }),
  },
  async (input) => {
    const config = getConfig();
    const crashDir = input.crashDir ?? getXcodeCrashesDir(config);
    const appticsDir = getAppticsCrashesDir(config);
    const otherDir = getOtherCrashesDir(config);
    const dsymPath = input.dsymPath ?? config.DSYM_PATH;
    const appPath = input.appPath ?? config.APP_PATH;
    const outputDir = input.outputDir ?? getSymbolicatedDir(config);
    if (input.crashDir) assertPathUnderBase(input.crashDir, config.CRASH_ANALYSIS_PARENT);
    if (input.outputDir) assertPathUnderBase(input.outputDir, config.CRASH_ANALYSIS_PARENT);
    if (input.dsymPath) assertNoTraversal(input.dsymPath);
    if (input.appPath) assertNoTraversal(input.appPath);

    if (!dsymPath) {
      const result = {
        succeeded: 0,
        failed: 0,
        total: 0,
        results: [],
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }

    // Check whether any .crash/.ips files exist across all three input folders
    // When crashDir is overridden by the caller, only check that dir; otherwise check all three
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
        structuredContent: { succeeded: 0, failed: 0, total: 0, results: [] },
      };
    }

    // Run batch for each input directory and merge results
    const dirsToProcess = inputIsDefault
      ? [crashDir, appticsDir, otherDir]
      : [crashDir];

    let succeeded = 0;
    let failed = 0;
    let total = 0;
    const results: BatchResult[] = [];

    for (const dir of dirsToProcess) {
      const batchResult = await runBatch(dir, dsymPath, appPath, outputDir, input.arch, input.allThreads ?? false);
      succeeded += batchResult.succeeded;
      failed += batchResult.failed;
      total += batchResult.total;
      results.push(...batchResult.results);
    }

    const result = { succeeded, failed, total, results };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Tool 6: diagnose_frames ──────────────────────────────────────────────────
server.registerTool(
  "diagnose_frames",
  {
    description:
      "Post-symbolication frame-by-frame diff report. Compares original vs symbolicated to show which frames were resolved.",
    inputSchema: z.object({
      crashPath: z.string().describe("Path to original crash file"),
      symbolicatedPath: z.string().describe("Path to symbolicated crash file"),
      appName: z.string().optional().describe("App binary name to filter frames"),
    }),
    outputSchema: z.object({
      appFramesSymbolicated: z.number(),
      appFramesMissed: z.number(),
      totalFrames: z.number(),
      frames: z.array(
        z.object({
          index: z.number(),
          library: z.string(),
          address: z.string(),
          originalSymbol: z.string(),
          resolvedSymbol: z.string(),
          symbolicated: z.boolean(),
        })
      ),
    }),
  },
  async (input) => {
    const config = getConfig();
    const appName = input.appName ?? config.APP_NAME;
    const result = diagnoseFrames(input.crashPath, input.symbolicatedPath, appName);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Tool 7: analyze_crashes ──────────────────────────────────────────────────
server.registerTool(
  "analyze_crashes",
  {
    description:
      "Group and deduplicate symbolicated crashes by unique signature. Returns a JSON crash analysis report.",
    inputSchema: z.object({
      crashDir: z.string().optional().describe("Directory of symbolicated crash files"),
    }),
    outputSchema: z.object({
      report_date: z.string(),
      source_dir: z.string(),
      total_crashes: z.number(),
      unique_crash_types: z.number(),
      crash_groups: z.array(z.any()),
    }),
  },
  async (input) => {
    const config = getConfig();
    const crashDir = input.crashDir ?? getSymbolicatedDir(config);
    if (input.crashDir) assertPathUnderBase(input.crashDir, config.CRASH_ANALYSIS_PARENT);
    const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
    const fixStatuses: Record<string, { fixed: boolean; note?: string }> = {};
    for (const entry of tracker.getAll()) {
      fixStatuses[entry.signature] = { fixed: entry.fixed, note: entry.note };
    }
    const result = analyzeDirectory(crashDir, fixStatuses);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Tool 8: notify_cliq ──────────────────────────────────────────────────────
server.registerTool(
  "notify_cliq",
  {
    description:
      "Send crash analysis report to configured Zoho Cliq channel webhook. Requires ZOHO_CLIQ_WEBHOOK_URL in env.",
    inputSchema: z.object({
      report: z.string().describe("JSON string of the crash analysis report"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
    }),
  },
  async (input) => {
    const config = getConfig();
    let report;
    const MAX_REPORT_SIZE = 10 * 1024 * 1024; // 10 MB
    if (input.report.length > MAX_REPORT_SIZE) {
      const result = { success: false, message: `Report payload too large (${input.report.length} bytes, max ${MAX_REPORT_SIZE})` };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
    try {
      report = JSON.parse(input.report);
    } catch {
      const result = { success: false, message: "Invalid JSON in report parameter." };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
    const result = await sendCrashReportToCliq(report, config);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Tool 9: set_fix_status ───────────────────────────────────────────────────
server.registerTool(
  "set_fix_status",
  {
    description: "Mark a crash signature as fixed or unfixed in local tracking.",
    inputSchema: z.object({
      signature: z.string().describe("Crash signature string"),
      fixed: z.boolean().describe("Whether the crash is fixed"),
      note: z.string().optional().describe("Optional note (e.g. PR reference)"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      status: z.string(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
    const status = tracker.setFixed(input.signature, input.fixed, input.note);
    const result = {
      success: true,
      status: `Marked as ${status.fixed ? "fixed" : "unfixed"}${status.note ? ` — ${status.note}` : ""} at ${status.updatedAt}`,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Tool 10: remove_fix_status ───────────────────────────────────────────────
server.registerTool(
  "remove_fix_status",
  {
    description: "Remove fix tracking for a crash signature.",
    inputSchema: z.object({
      signature: z.string().describe("Crash signature string"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      removed: z.boolean(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
    const removed = tracker.remove(input.signature);
    const result = { success: true, removed };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Tool 11: list_fix_statuses ───────────────────────────────────────────────
server.registerTool(
  "list_fix_statuses",
  {
    description: "Show all locally tracked fix statuses.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      total: z.number(),
      fixed: z.number(),
      unfixed: z.number(),
      statuses: z.array(
        z.object({
          signature: z.string(),
          fixed: z.boolean(),
          note: z.string().optional(),
          updatedAt: z.string(),
        })
      ),
    }),
  },
  async () => {
    const config = getConfig();
    const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
    const statuses = tracker.getAll();
    const result = {
      total: statuses.length,
      fixed: statuses.filter((s) => s.fixed).length,
      unfixed: statuses.filter((s) => !s.fixed).length,
      statuses,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Tool 12: run_full_pipeline ───────────────────────────────────────────────
server.registerTool(
  "run_full_pipeline",
  {
    description:
      "Run the complete crash analysis pipeline: export → symbolicate → analyze → optionally notify Cliq. All paths (dSYM, app, directories) are auto-configured from environment variables — no path input is required.",
    inputSchema: z.object({
      notify: z.boolean().optional().describe("Send report to Cliq after analysis"),
      versions: z.string().optional().describe("Comma-separated version filter for export"),
      startDate: z.string().optional().describe("ISO date string to filter crashes from (e.g. 2026-03-01)"),
      endDate: z.string().optional().describe("ISO date string to filter crashes until (e.g. 2026-03-20)"),
    }),
    outputSchema: z.object({
      export_result: z.any(),
      symbolication_result: z.any(),
      analysis_report: z.any(),
      notification_sent: z.boolean().optional(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
    const basicDir = getXcodeCrashesDir(config);
    const symbolicatedDir = getSymbolicatedDir(config);
    const versions =
      input.versions?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];

    // Step 1: Export
    const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false, input.startDate, input.endDate);

    // Step 2: Symbolicate
    const dsymPath = config.DSYM_PATH;
    const appPath = config.APP_PATH;
    let symbolicationResult: object = { skipped: true, reason: "DSYM_PATH not configured" };

    if (dsymPath) {
      const appticsDir = getAppticsCrashesDir(config);
      const otherDir = getOtherCrashesDir(config);

      const anyFiles =
        hasCrashFiles(basicDir) || hasCrashFiles(appticsDir) || hasCrashFiles(otherDir);

      if (!anyFiles) {
        symbolicationResult = {
          skipped: true,
          reason: "No .crash or .ips files found in MainCrashLogsFolder/XCodeCrashLogs, MainCrashLogsFolder/AppticsCrashLogs, or MainCrashLogsFolder/OtherCrashLogs",
        };
      } else {
        let succeeded = 0;
        let failed = 0;
        let total = 0;
        const results: BatchResult[] = [];
        for (const dir of [basicDir, appticsDir, otherDir]) {
          const r = await runBatch(dir, dsymPath, appPath, symbolicatedDir);
          succeeded += r.succeeded;
          failed += r.failed;
          total += r.total;
          results.push(...r.results);
        }
        symbolicationResult = { succeeded, failed, total, results };
      }
    }

    // Step 3: Analyze
    const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
    const fixStatuses: Record<string, { fixed: boolean; note?: string }> = {};
    for (const entry of tracker.getAll()) {
      fixStatuses[entry.signature] = { fixed: entry.fixed, note: entry.note };
    }
    const analysisReport = analyzeDirectory(symbolicatedDir, fixStatuses);

    // Step 4: Optionally notify
    let notificationSent: boolean | undefined;
    if (input.notify) {
      const notifResult = await sendCrashReportToCliq(analysisReport, config);
      notificationSent = notifResult.success;
    }

    const result = {
      export_result: exportResult,
      symbolication_result: symbolicationResult,
      analysis_report: analysisReport,
      notification_sent: notificationSent,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Tool 13: setup_folders ───────────────────────────────────────────────────
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
      existingCrashLogsDir: z.string().optional().describe("If provided, copies .crash and .ips files from this directory into MainCrashLogsFolder/XCodeCrashLogs"),
    }),
    outputSchema: z.object({
      parentDir: z.string(),
      created: z.array(z.string()),
      symlinks: z.array(z.object({ link: z.string(), target: z.string(), status: z.string() })),
      copiedFiles: z.number().optional(),
      warnings: z.array(z.string()),
    }),
  },
  async (input) => {
    const config = getConfig();
    const parentDir = config.CRASH_ANALYSIS_PARENT;
    const mainCrashDir = getMainCrashLogsDir(config);
    const xcodeCrashDir = getXcodeCrashesDir(config);
    const appticsDir = getAppticsCrashesDir(config);
    const otherDir = getOtherCrashesDir(config);
    const symbolicatedDir = getSymbolicatedDir(config);

    const created: string[] = [];
    const warnings: string[] = [];

    // Always create mainCrashDir and xcodeCrashDir
    for (const dir of [parentDir, mainCrashDir, xcodeCrashDir, symbolicatedDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        created.push(dir);
      }
    }
    // Create AppticsCrashLogs and OtherCrashLogs only if they don't already exist
    for (const dir of [appticsDir, otherDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        created.push(dir);
      }
    }

    // Handle symlinks
    const symlinks: Array<{ link: string; target: string; status: string }> = [];

    const symlinkDefs: Array<{ name: string; target: string | undefined }> = [
      { name: "CurrentMasterLiveBranch", target: input.masterBranchPath ?? config.MASTER_BRANCH_PATH },
      { name: "CurrentDevelopmentBranch", target: input.devBranchPath ?? config.DEV_BRANCH_PATH },
      { name: "dSYM_File", target: input.dsymPath ?? config.DSYM_PATH },
      { name: "app_File", target: input.appPath ?? config.APP_PATH },
    ];

    for (const { name, target } of symlinkDefs) {
      if (!target) continue;
      assertNoTraversal(target);
      assertSafeSymlinkTarget(target);
      const resolvedTarget = path.resolve(target);
      const linkPath = path.join(parentDir, name);
      let status: string;

      if (!fs.existsSync(resolvedTarget)) {
        warnings.push(`Target for ${name} does not exist: ${resolvedTarget}`);
      }

      try {
        // Remove existing symlink/file if present (lstatSync detects broken symlinks too)
        fs.lstatSync(linkPath);
        fs.rmSync(linkPath, { force: true });
      } catch {
        // Path doesn't exist — nothing to remove
      }

      let symlinkType: "dir" | "file" = "file";
      if (fs.existsSync(resolvedTarget)) {
        symlinkType = fs.statSync(resolvedTarget).isDirectory() ? "dir" : "file";
      } else {
        // Target doesn't exist yet — infer type from path extension
        const lowerTarget = resolvedTarget.toLowerCase();
        if (
          lowerTarget.endsWith(".dsym") ||
          lowerTarget.endsWith(".app") ||
          lowerTarget.endsWith(".framework") ||
          !path.extname(resolvedTarget)
        ) {
          symlinkType = "dir";
        }
      }

      try {
        fs.symlinkSync(resolvedTarget, linkPath, symlinkType);
        status = "created";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        status = `failed: ${msg}`;
        warnings.push(`Could not create symlink ${name}: ${msg}`);
      }

      symlinks.push({ link: linkPath, target: resolvedTarget, status });
    }

    // Copy crash files from existingCrashLogsDir if provided
    let copiedFiles: number | undefined;
    if (input.existingCrashLogsDir) {
      copiedFiles = 0;
      try {
        const srcFiles = fs.readdirSync(input.existingCrashLogsDir).filter(
          (f) => f.endsWith(".crash") || f.endsWith(".ips")
        );
        for (const file of srcFiles) {
          const src = path.join(input.existingCrashLogsDir, file);
          const dest = path.join(xcodeCrashDir, file);
          fs.copyFileSync(src, dest);
          copiedFiles++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Could not copy from existingCrashLogsDir: ${msg}`);
      }
    }

    const result = { parentDir, created, symlinks, copiedFiles, warnings };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Tool 14: notify_unfixed_cliq ─────────────────────────────────────────────
server.registerTool(
  "notify_unfixed_cliq",
  {
    description:
      "Analyze symbolicated crashes, filter to only UNFIXED crash types, and send the filtered report to Zoho Cliq. Crashes marked as 'fixed in development' via set_fix_status are excluded.",
    inputSchema: z.object({
      crashDir: z.string().optional().describe("Directory of symbolicated crash files (default: SymbolicatedCrashLogsFolder)"),
      notify: z.boolean().optional().describe("Actually send to Cliq (default: true). Set false for dry-run."),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
      totalUnfixed: z.number(),
      totalFixed: z.number(),
      reportSent: z.boolean(),
      unfixedReport: z.any().optional(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const crashDir = input.crashDir ?? getSymbolicatedDir(config);
    const shouldNotify = input.notify !== false;

    // Load fix statuses
    const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
    const fixStatuses: Record<string, { fixed: boolean; note?: string }> = {};
    for (const entry of tracker.getAll()) {
      fixStatuses[entry.signature] = { fixed: entry.fixed, note: entry.note };
    }

    // Analyze directory with fix statuses
    const fullReport = analyzeDirectory(crashDir, fixStatuses);

    // Separate fixed vs unfixed
    const fixedGroups = fullReport.crash_groups.filter(
      (g) => g.fix_status?.fixed === true
    );
    const unfixedGroups = fullReport.crash_groups.filter(
      (g) => !g.fix_status || g.fix_status.fixed === false
    );

    // Rebuild report with only unfixed groups
    const unfixedReport = {
      ...fullReport,
      report_type: "unfixed-only",
      crash_groups: unfixedGroups.map((g, idx) => ({ ...g, rank: idx + 1 })),
      total_crashes: unfixedGroups.reduce((sum, g) => sum + g.count, 0),
      unique_crash_types: unfixedGroups.length,
    };

    if (!shouldNotify) {
      const result = {
        success: true,
        message: `Dry-run: ${unfixedGroups.length} unfixed crash type(s), ${fixedGroups.length} fixed. No notification sent.`,
        totalUnfixed: unfixedGroups.length,
        totalFixed: fixedGroups.length,
        reportSent: false,
        unfixedReport,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }

    if (unfixedGroups.length === 0) {
      const result = {
        success: true,
        message: "No unfixed crashes to report.",
        totalUnfixed: 0,
        totalFixed: fixedGroups.length,
        reportSent: false,
        unfixedReport,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }

    const cliqResult = await sendCrashReportToCliq(unfixedReport, config);
    const result = {
      success: cliqResult.success,
      message: cliqResult.message,
      totalUnfixed: unfixedGroups.length,
      totalFixed: fixedGroups.length,
      reportSent: cliqResult.success,
      unfixedReport,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Tool 15: report_to_zoho_projects ─────────────────────────────────────────
server.registerTool(
  "report_to_zoho_projects",
  {
    description:
      "Analyze symbolicated crashes and create a bug in Zoho Projects for each unique crash group. Severity is auto-mapped from exception type and occurrence count. Fix status is read from local tracking. Requires ZOHO_PROJECTS_MCP_URL, ZOHO_PROJECTS_PORTAL_ID, and ZOHO_PROJECTS_PROJECT_ID to be configured.",
    inputSchema: z.object({
      crashDir: z.string().optional().describe("Directory of symbolicated crash files (default: SymbolicatedCrashLogsFolder)"),
      unfixedOnly: z.boolean().optional().describe("Only create bugs for unfixed crashes (default: false)"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
      totalBugsCreated: z.number(),
      totalFailed: z.number(),
      bugs: z.array(z.any()),
      missingFieldIds: z.array(z.string()),
    }),
  },
  async (input) => {
    const config = getConfig();

    if (!config.ZOHO_PROJECTS_MCP_URL) {
      throw new Error("ZOHO_PROJECTS_MCP_URL env var is required for report_to_zoho_projects.");
    }
    if (!config.ZOHO_PROJECTS_PORTAL_ID) {
      throw new Error("ZOHO_PROJECTS_PORTAL_ID env var is required for report_to_zoho_projects.");
    }
    if (!config.ZOHO_PROJECTS_PROJECT_ID) {
      throw new Error("ZOHO_PROJECTS_PROJECT_ID env var is required for report_to_zoho_projects.");
    }

    const crashDir = input.crashDir ?? getSymbolicatedDir(config);
    if (input.crashDir) assertPathUnderBase(input.crashDir, config.CRASH_ANALYSIS_PARENT);

    // Load fix statuses
    const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
    const fixStatuses: Record<string, { fixed: boolean; note?: string }> = {};
    for (const entry of tracker.getAll()) {
      fixStatuses[entry.signature] = { fixed: entry.fixed, note: entry.note };
    }

    const report = analyzeDirectory(crashDir, fixStatuses);

    if (input.unfixedOnly) {
      const unfixedGroups = report.crash_groups.filter(
        (g) => !g.fix_status || g.fix_status.fixed === false
      );
      report.crash_groups = unfixedGroups.map((g, idx) => ({ ...g, rank: idx + 1 }));
      report.report_type = "unfixed-only";
      report.unique_crash_types = report.crash_groups.length;
      report.total_crashes = report.crash_groups.reduce((sum, g) => sum + g.count, 0);
    }

    const fieldIds = getFieldIdsFromConfig(config);
    const result = await reportToZohoProjectsViaMcp(
      report,
      config.ZOHO_PROJECTS_MCP_URL,
      config.ZOHO_PROJECTS_PORTAL_ID,
      config.ZOHO_PROJECTS_PROJECT_ID,
      fieldIds
    );

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ── Bootstrap ────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();
