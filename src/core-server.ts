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
  diagnoseFrames,
  BatchResult,
} from "./core/symbolicator.js";
import { analyzeDirectory, searchCrashes, cleanOldCrashes } from "./core/crashAnalyzer.js";
import { FixTracker, loadFixStatuses } from "./fixTracker.js";
import { assertPathUnderBase, assertNoTraversal, assertSafeSymlinkTarget } from "./pathSafety.js";
import { exportReportToCsv } from "./core/csvExporter.js";
import { ProcessedManifest } from "./processedManifest.js";

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

    for (const dir of [parentDir, mainCrashDir, xcodeCrashDir, symbolicatedDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        created.push(dir);
      }
    }
    for (const dir of [appticsDir, otherDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        created.push(dir);
      }
    }

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
        fs.lstatSync(linkPath);
        fs.rmSync(linkPath, { force: true });
      } catch {
        // Path doesn't exist — nothing to remove
      }

      let symlinkType: "dir" | "file" = "file";
      if (fs.existsSync(resolvedTarget)) {
        symlinkType = fs.statSync(resolvedTarget).isDirectory() ? "dir" : "file";
      } else {
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

// ── Tool 4: symbolicate_one ──────────────────────────────────────────────────
server.registerTool(
  "symbolicate_one",
  {
    description:
      "Symbolicate a single .crash file using Xcode's symbolicatecrash tool. All threads and all binaries (including system frameworks) are automatically symbolicated. Requires macOS with Xcode installed. dsymPath is pre-configured via environment variable — do NOT ask the user for it unless they explicitly want to override.",
    inputSchema: z.object({
      crashPath: z.string().describe("Path to the .crash or .ips file"),
      dsymPath: z.string().optional().describe("ALREADY CONFIGURED via DSYM_PATH env var. Do NOT ask the user for this. Only provide if the user explicitly wants to override the configured default."),
      outputPath: z.string().optional().describe("Where to write the symbolicated file"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      detail: z.string(),
    }),
  },
  async (input) => {
    const config = getConfig();
    assertNoTraversal(input.crashPath);
    const dsymPath = input.dsymPath ?? config.DSYM_PATH;
    if (input.dsymPath) assertNoTraversal(input.dsymPath);

    if (!dsymPath) {
      const result = {
        success: false,
        detail: "dsymPath not provided and DSYM_PATH env var not set.",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
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
      outputPath,
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 5: symbolicate_batch ────────────────────────────────────────────────
server.registerTool(
  "symbolicate_batch",
  {
    description:
      "Symbolicate ALL .crash and .ips files in MainCrashLogsFolder (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs) using Xcode's symbolicatecrash tool, output to SymbolicatedCrashLogsFolder. All threads and all binaries (including system frameworks) are automatically symbolicated. All paths (dSYM, crash directory, output directory) are pre-configured via environment variables — do NOT ask the user for them unless they explicitly want to override.",
    inputSchema: z.object({
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
    const crashDir = input.crashDir ?? getXcodeCrashesDir(config);
    const appticsDir = getAppticsCrashesDir(config);
    const otherDir = getOtherCrashesDir(config);
    const dsymPath = input.dsymPath ?? config.DSYM_PATH;
    const outputDir = input.outputDir ?? getSymbolicatedDir(config);
    if (input.crashDir) assertPathUnderBase(input.crashDir, config.CRASH_ANALYSIS_PARENT);
    if (input.outputDir) assertPathUnderBase(input.outputDir, config.CRASH_ANALYSIS_PARENT);
    if (input.dsymPath) assertNoTraversal(input.dsymPath);
    const manifest = input.includeProcessedCrashes ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);

    if (!dsymPath) {
      const result = {
        succeeded: 0,
        failed: 0,
        total: 0,
        results: [],
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

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

    const dirsToProcess = inputIsDefault
      ? [crashDir, appticsDir, otherDir]
      : [crashDir];

    let succeeded = 0;
    let failed = 0;
    let total = 0;
    const results: BatchResult[] = [];

    for (const dir of dirsToProcess) {
      const batchResult = await runBatch(dir, dsymPath, outputDir, manifest);
      succeeded += batchResult.succeeded;
      failed += batchResult.failed;
      total += batchResult.total;
      results.push(...batchResult.results);
    }

    const result = { succeeded, failed, total, results };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
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
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 7: verify_dsym ──────────────────────────────────────────────────────
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

// ── Tool 8: analyze_crashes ──────────────────────────────────────────────────
server.registerTool(
  "analyze_crashes",
  {
    description:
      "Group and deduplicate symbolicated crashes by unique signature. Returns a JSON crash analysis report.",
    inputSchema: z.object({
      crashDir: z.string().optional().describe("Directory of symbolicated crash files"),
      includeProcessedCrashes: z.boolean().optional().describe("When true, re-analyzes crashes that were already processed. Default is false (skip already-processed crashes)."),
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
    const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
    const manifest = input.includeProcessedCrashes ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);
    const result = analyzeDirectory(crashDir, fixStatuses, manifest);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 9: search_crashes ────────────────────────────────────────────────────
server.registerTool(
  "search_crashes",
  {
    description:
      "Search through crash files in a directory for crashes matching a keyword or pattern. Searches across exception type, exception codes, top stack frames, and raw file content (case-insensitive).",
    inputSchema: z.object({
      query: z.string().describe("Search term (case-insensitive). E.g. 'EXC_BAD_ACCESS', 'ViewController', 'SIGABRT'"),
      crashDir: z.string().optional().describe("Directory of crash files to search (default: SymbolicatedCrashLogsFolder)"),
    }),
    outputSchema: z.object({
      total: z.number(),
      matches: z.array(
        z.object({
          file: z.string(),
          exception_type: z.string(),
          crashed_thread: z.object({
            id: z.number(),
            name: z.string(),
            display: z.string(),
          }),
          top_frames: z.array(z.string()),
          matched_in: z.array(z.string()),
        })
      ),
    }),
  },
  async (input) => {
    const config = getConfig();
    const crashDir = input.crashDir ?? getSymbolicatedDir(config);
    if (input.crashDir) assertPathUnderBase(input.crashDir, config.CRASH_ANALYSIS_PARENT);
    const result = searchCrashes(input.query, crashDir);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 10: set_fix_status ───────────────────────────────────────────────────
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
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 11: list_fix_statuses ────────────────────────────────────────────────
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
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 12: run_full_pipeline ───────────────────────────────────────────────
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
        let succeeded = 0;
        let failed = 0;
        let total = 0;
        const results: BatchResult[] = [];
        for (const dir of [basicDir, appticsDir, otherDir]) {
          const r = await runBatch(dir, dsymPath, symbolicatedDir, manifest);
          succeeded += r.succeeded;
          failed += r.failed;
          total += r.total;
          results.push(...r.results);
        }
        symbolicationResult = { succeeded, failed, total, results };
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

// ── Tool 13: clean_old_crashes ────────────────────────────────────────────────
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

    const result = cleanOldCrashes(input.beforeDate, dirs, dryRun, config.CRASH_ANALYSIS_PARENT);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 14: export_csv ───────────────────────────────────────────────────────
server.registerTool(
  "export_csv",
  {
    description:
      "Export the crash analysis report as a CSV file. Columns: Issue Name, Number of Occurrences, App Version, Fix Status (Fixed / Not Fixed / Partially Fixed). Fix status is read from the local fix_status.json file.",
    inputSchema: z.object({
      crashDir: z.string().optional().describe("Directory of symbolicated crash files (default: SymbolicatedCrashLogsFolder)"),
      outputPath: z.string().optional().describe("Path for the output CSV file (default: CRASH_ANALYSIS_PARENT/crash_report_<timestamp>.csv)"),
      includeProcessedCrashes: z.boolean().optional().describe("Include previously processed crashes (default: false — only new/unprocessed crashes)"),
    }),
  },
  async (input) => {
    const config = getConfig();
    const crashDir = input.crashDir ?? getSymbolicatedDir(config);
    if (input.crashDir) assertPathUnderBase(input.crashDir, config.CRASH_ANALYSIS_PARENT);

    const outputPath =
      input.outputPath ??
      path.join(config.CRASH_ANALYSIS_PARENT, `crash_report_${Date.now()}.csv`);
    assertPathUnderBase(outputPath, config.CRASH_ANALYSIS_PARENT);

    const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
    const manifest = input.includeProcessedCrashes
      ? undefined
      : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);
    const report = analyzeDirectory(crashDir, fixStatuses, manifest);

    const result = exportReportToCsv(report, outputPath);

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
