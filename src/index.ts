#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";

import { getConfig, getBasicCrashesDir, getSymbolicatedDir } from "./config.js";
import {
  listAvailableVersions,
  exportCrashLogs,
} from "./crashExporter.js";
import {
  symbolicateOne,
  runBatch,
  diagnoseFrames,
} from "./symbolicator.js";
import { analyzeDirectory } from "./crashAnalyzer.js";
import { sendCrashReportToCliq } from "./cliqNotifier.js";
import { FixTracker } from "./fixTracker.js";

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
    return { versions };
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
    const outputDir = input.outputDir ?? getBasicCrashesDir(config);
    const versions = input.versions?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
    const recursive = input.recursive ?? false;

    const result = exportCrashLogs(inputDir, outputDir, versions, recursive, true);
    return {
      would_export: result.exported,
      would_skip: result.skipped,
      files: result.files,
    };
  }
);

// ── Tool 3: export_crashes ───────────────────────────────────────────────────
server.registerTool(
  "export_crashes",
  {
    description:
      "Export .crash files from .xccrashpoint packages into BasicCrashLogsFolder.",
    inputSchema: z.object({
      inputDir: z.string().optional().describe("Directory to search for .xccrashpoint files"),
      outputDir: z.string().optional().describe("Destination directory for crash logs"),
      versions: z.string().optional().describe("Comma-separated version filter"),
      recursive: z.boolean().optional().describe("Search subdirectories recursively"),
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
    const outputDir = input.outputDir ?? getBasicCrashesDir(config);
    const versions = input.versions?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
    const recursive = input.recursive ?? false;

    return exportCrashLogs(inputDir, outputDir, versions, recursive, false);
  }
);

// ── Tool 4: symbolicate_one ──────────────────────────────────────────────────
server.registerTool(
  "symbolicate_one",
  {
    description:
      "Symbolicate a single .crash file using atos. Requires macOS with Xcode CLI tools.",
    inputSchema: z.object({
      crashPath: z.string().describe("Path to the .crash or .ips file"),
      dsymPath: z.string().optional().describe("Path to the .dSYM bundle (defaults from env)"),
      appPath: z.string().optional().describe("Path to the .app bundle (defaults from env)"),
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
    const dsymPath = input.dsymPath ?? config.DSYM_PATH;
    const appPath = input.appPath ?? config.APP_PATH;

    if (!dsymPath) {
      return {
        success: false,
        detail: "dsymPath not provided and DSYM_PATH env var not set.",
        symbolicatedCount: 0,
        totalAppFrames: 0,
      };
    }

    const outputPath =
      input.outputPath ??
      path.join(
        getSymbolicatedDir(config),
        path.basename(input.crashPath)
      );

    return symbolicateOne(
      input.crashPath,
      dsymPath,
      appPath,
      outputPath,
      input.arch,
      input.allThreads ?? false
    );
  }
);

// ── Tool 5: symbolicate_batch ────────────────────────────────────────────────
server.registerTool(
  "symbolicate_batch",
  {
    description:
      "Symbolicate ALL .crash and .ips files in BasicCrashLogsFolder, output to SymbolicatedCrashLogsFolder.",
    inputSchema: z.object({
      crashDir: z.string().optional().describe("Directory containing raw crash files"),
      dsymPath: z.string().optional().describe("Path to .dSYM bundle (defaults from env)"),
      appPath: z.string().optional().describe("Path to .app bundle (defaults from env)"),
      outputDir: z.string().optional().describe("Output directory for symbolicated files"),
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
    const crashDir = input.crashDir ?? getBasicCrashesDir(config);
    const dsymPath = input.dsymPath ?? config.DSYM_PATH;
    const appPath = input.appPath ?? config.APP_PATH;
    const outputDir = input.outputDir ?? getSymbolicatedDir(config);

    if (!dsymPath) {
      return {
        succeeded: 0,
        failed: 0,
        total: 0,
        results: [],
      };
    }

    return runBatch(crashDir, dsymPath, appPath, outputDir, input.arch, input.allThreads ?? false);
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
    return diagnoseFrames(input.crashPath, input.symbolicatedPath, appName);
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
    return analyzeDirectory(crashDir);
  }
);

// ── Tool 8: notify_cliq ──────────────────────────────────────────────────────
server.registerTool(
  "notify_cliq",
  {
    description:
      "Send crash analysis report to configured Zoho Cliq Bot/channel webhook. Requires ZOHO_CLIQ_WEBHOOK_URL or ZOHO_CLIQ_BOT_WEBHOOK_URL in env.",
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
    try {
      report = JSON.parse(input.report);
    } catch {
      return { success: false, message: "Invalid JSON in report parameter." };
    }
    return sendCrashReportToCliq(report, config);
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
    return {
      success: true,
      status: `Marked as ${status.fixed ? "fixed" : "unfixed"}${status.note ? ` — ${status.note}` : ""} at ${status.updatedAt}`,
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
    return { success: true, removed };
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
    return {
      total: statuses.length,
      fixed: statuses.filter((s) => s.fixed).length,
      unfixed: statuses.filter((s) => !s.fixed).length,
      statuses,
    };
  }
);

// ── Tool 12: run_full_pipeline ───────────────────────────────────────────────
server.registerTool(
  "run_full_pipeline",
  {
    description:
      "Run the complete crash analysis pipeline: export → symbolicate → analyze → optionally notify Cliq.",
    inputSchema: z.object({
      notify: z.boolean().optional().describe("Send report to Cliq after analysis"),
      versions: z.string().optional().describe("Comma-separated version filter for export"),
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
    const basicDir = getBasicCrashesDir(config);
    const symbolicatedDir = getSymbolicatedDir(config);
    const versions =
      input.versions?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];

    // Step 1: Export
    const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false);

    // Step 2: Symbolicate
    const dsymPath = config.DSYM_PATH;
    const appPath = config.APP_PATH;
    let symbolicationResult: object = { skipped: true, reason: "DSYM_PATH not configured" };

    if (dsymPath) {
      symbolicationResult = await runBatch(basicDir, dsymPath, appPath, symbolicatedDir);
    }

    // Step 3: Analyze
    const analysisReport = analyzeDirectory(symbolicatedDir);

    // Step 4: Optionally notify
    let notificationSent: boolean | undefined;
    if (input.notify) {
      const notifResult = await sendCrashReportToCliq(analysisReport, config);
      notificationSent = notifResult.success;
    }

    return {
      export_result: exportResult,
      symbolication_result: symbolicationResult,
      analysis_report: analysisReport,
      notification_sent: notificationSent,
    };
  }
);

// ── Tool 13: setup_folders ───────────────────────────────────────────────────
server.registerTool(
  "setup_folders",
  {
    description:
      "Create the ParentHolderFolder directory structure (BasicCrashLogsFolder, SymbolicatedCrashLogsFolder).",
    inputSchema: z.object({}),
    outputSchema: z.object({
      parentDir: z.string(),
      created: z.array(z.string()),
    }),
  },
  async () => {
    const config = getConfig();
    const parentDir = config.CRASH_ANALYSIS_PARENT;
    const basicDir = getBasicCrashesDir(config);
    const symbolicatedDir = getSymbolicatedDir(config);

    const created: string[] = [];

    for (const dir of [parentDir, basicDir, symbolicatedDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        created.push(dir);
      }
    }

    return { parentDir, created };
  }
);

// ── Bootstrap ────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();
