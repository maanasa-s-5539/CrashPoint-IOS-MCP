#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getConfig, getBasicCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, hasCrashFiles } from "./config.js";
import { exportCrashLogs } from "./crashExporter.js";
import { runBatch, symbolicateOne, diagnoseFrames, BatchResult } from "./symbolicator.js";
import { analyzeDirectory } from "./crashAnalyzer.js";
import { sendCrashReportToCliq } from "./cliqNotifier.js";
import { FixTracker } from "./fixTracker.js";
import { listAvailableVersions } from "./crashExporter.js";
import { assertPathUnderBase, assertNoTraversal, assertSafeSymlinkTarget } from "./pathSafety.js";

const [, , command, ...args] = process.argv;

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
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

async function cmdExport(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const outputDir = getBasicCrashesDir(config);
  const versions = config.CRASH_VERSIONS?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  const startDate = flags["start-date"] as string | undefined;
  const endDate = flags["end-date"] as string | undefined;
  const result = exportCrashLogs(inputDir, outputDir, versions, false, false, startDate, endDate);
  console.log(JSON.stringify(result, null, 2));
}

async function cmdBatch(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const crashDir = getBasicCrashesDir(config);
  const appticsDir = getAppticsCrashesDir(config);
  const otherDir = getOtherCrashesDir(config);
  const outputDir = getSymbolicatedDir(config);
  const dsymPath = config.DSYM_PATH;
  const appPath = config.APP_PATH;
  const allThreads = flags["all-threads"] === true;

  if (!dsymPath) {
    console.error("Error: DSYM_PATH env var is required for batch symbolication.");
    process.exit(1);
  }

  if (!hasCrashFiles(crashDir) && !hasCrashFiles(appticsDir) && !hasCrashFiles(otherDir)) {
    console.log(
      JSON.stringify({
        succeeded: 0,
        failed: 0,
        total: 0,
        results: [],
        message: "No .crash or .ips files found in BasicCrashLogsFolder, AppticsCrashLogsFolder, or OtherCrashLogsFolder",
      }, null, 2)
    );
    return;
  }

  let succeeded = 0;
  let failed = 0;
  let total = 0;
  const results: BatchResult[] = [];

  for (const dir of [crashDir, appticsDir, otherDir]) {
    const r = await runBatch(dir, dsymPath, appPath, outputDir, undefined, allThreads);
    succeeded += r.succeeded;
    failed += r.failed;
    total += r.total;
    results.push(...r.results);
  }

  console.log(JSON.stringify({ succeeded, failed, total, results }, null, 2));
}

async function cmdAnalyze(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const crashDir = (flags["crash-dir"] as string) ?? getSymbolicatedDir(config);
  const outputFile = (flags["o"] as string) ?? undefined;

  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  const fixStatuses: Record<string, { fixed: boolean; note?: string }> = {};
  for (const entry of tracker.getAll()) {
    fixStatuses[entry.signature] = { fixed: entry.fixed, note: entry.note };
  }

  const report = analyzeDirectory(crashDir, fixStatuses);

  const json = JSON.stringify(report, null, 2);
  if (outputFile) {
    fs.writeFileSync(outputFile, json, "utf-8");
    console.log(`Report written to ${path.resolve(outputFile)}`);
  } else {
    console.log(json);
  }
}

async function cmdNotify(flags: Record<string, string | boolean>): Promise<void> {
  const reportFile = flags["report"] as string;
  if (!reportFile) {
    console.error("Error: --report <path> is required for notify command.");
    process.exit(1);
  }

  let report;
  try {
    const raw = fs.readFileSync(reportFile, "utf-8");
    report = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error reading report file: ${msg}`);
    process.exit(1);
  }

  const config = getConfig();
  const result = await sendCrashReportToCliq(report, config);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) {
    process.exit(1);
  }
}

async function cmdNotifyUnfixed(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const crashDir = (flags["crash-dir"] as string) ?? getSymbolicatedDir(config);
  const dryRun = flags["dry-run"] === true;
  const outputFile = (flags["o"] as string) ?? undefined;

  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  const fixStatuses: Record<string, { fixed: boolean; note?: string }> = {};
  for (const entry of tracker.getAll()) {
    fixStatuses[entry.signature] = { fixed: entry.fixed, note: entry.note };
  }

  const fullReport = analyzeDirectory(crashDir, fixStatuses);

  const fixedGroups = fullReport.crash_groups.filter((g) => g.fix_status?.fixed === true);
  const unfixedGroups = fullReport.crash_groups.filter(
    (g) => !g.fix_status || g.fix_status.fixed === false
  );

  const unfixedReport = {
    ...fullReport,
    report_type: "unfixed-only",
    crash_groups: unfixedGroups.map((g, idx) => ({ ...g, rank: idx + 1 })),
    total_crashes: unfixedGroups.reduce((sum, g) => sum + g.count, 0),
    unique_crash_types: unfixedGroups.length,
  };

  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify(unfixedReport, null, 2), "utf-8");
    console.log(`Filtered report written to ${path.resolve(outputFile)}`);
  }

  console.log(
    `Unfixed: ${unfixedGroups.length} type(s), Fixed: ${fixedGroups.length} type(s)`
  );

  if (dryRun) {
    if (!outputFile) {
      console.log(JSON.stringify(unfixedReport, null, 2));
    }
    console.log("Dry-run: no notification sent.");
    return;
  }

  if (unfixedGroups.length === 0) {
    console.log("No unfixed crashes to report. Skipping Cliq notification.");
    return;
  }

  const result = await sendCrashReportToCliq(unfixedReport, config);
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) {
    process.exit(1);
  }
}

async function cmdSetup(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const parentDir = config.CRASH_ANALYSIS_PARENT;
  const basicDir = path.join(parentDir, "BasicCrashLogsFolder");
  const appticsDir = path.join(parentDir, "AppticsCrashLogsFolder");
  const otherDir = path.join(parentDir, "OtherCrashLogsFolder");
  const symbolicatedDir = path.join(parentDir, "SymbolicatedCrashLogsFolder");

  const created: string[] = [];
  const warnings: string[] = [];

  for (const dir of [parentDir, basicDir, appticsDir, otherDir, symbolicatedDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }

  const masterBranchPath = (flags["master-branch"] as string) ?? config.MASTER_BRANCH_PATH;
  const devBranchPath = (flags["dev-branch"] as string) ?? config.DEV_BRANCH_PATH;
  const dsymPath = (flags["dsym"] as string) ?? config.DSYM_PATH;
  const appPath = (flags["app"] as string) ?? config.APP_PATH;

  const symlinkDefs: Array<{ name: string; target: string | undefined }> = [
    { name: "CurrentMasterLiveBranch", target: masterBranchPath },
    { name: "CurrentDevelopmentBranch", target: devBranchPath },
    { name: "dSYM_File", target: dsymPath },
    { name: "app_File", target: appPath },
  ];

  const symlinks: Array<{ link: string; target: string; status: string }> = [];
  for (const { name, target } of symlinkDefs) {
    if (!target) continue;
    assertNoTraversal(target);
    assertSafeSymlinkTarget(target);
    const resolvedTarget = path.resolve(target);
    const linkPath = path.join(parentDir, name);
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
      symlinks.push({ link: linkPath, target: resolvedTarget, status: "created" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not create symlink ${name}: ${msg}`);
      symlinks.push({ link: linkPath, target: resolvedTarget, status: `failed: ${msg}` });
    }
  }

  const existingCrashLogsDir = flags["crash-logs"] as string | undefined;
  let copiedFiles: number | undefined;
  if (existingCrashLogsDir) {
    copiedFiles = 0;
    try {
      const srcFiles = fs.readdirSync(existingCrashLogsDir).filter(
        (f) => f.endsWith(".crash") || f.endsWith(".ips")
      );
      for (const file of srcFiles) {
        fs.copyFileSync(path.join(existingCrashLogsDir, file), path.join(basicDir, file));
        copiedFiles++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not copy from crash-logs dir: ${msg}`);
    }
  }

  console.log(JSON.stringify({ parentDir, created, symlinks, copiedFiles, warnings }, null, 2));
}

async function cmdSymbolicateOne(flags: Record<string, string | boolean>): Promise<void> {
  const crashPath = flags["crash"] as string;
  if (!crashPath) {
    console.error("Error: --crash <path> is required for symbolicate-one command.");
    process.exit(1);
  }
  const config = getConfig();
  const dsymPath = (flags["dsym"] as string) ?? config.DSYM_PATH;
  const appPath = (flags["app"] as string) ?? config.APP_PATH;
  const outputPath = (flags["output"] as string) ?? path.join(config.CRASH_ANALYSIS_PARENT, "SymbolicatedCrashLogsFolder", path.basename(crashPath));
  const allThreads = flags["all-threads"] === true;

  if (!dsymPath) {
    console.error("Error: --dsym or DSYM_PATH env var is required.");
    process.exit(1);
  }

  const result = await symbolicateOne(crashPath, dsymPath, appPath, outputPath, undefined, allThreads);
  console.log(JSON.stringify(result, null, 2));
  if (result.success) {
    console.log(`Symbolicated output written to ${path.resolve(outputPath)}`);
  }
}

function cmdDiagnose(flags: Record<string, string | boolean>): void {
  const crashPath = flags["crash"] as string;
  const symbolicatedPath = flags["symbolicated"] as string;
  if (!crashPath || !symbolicatedPath) {
    console.error("Error: --crash <path> and --symbolicated <path> are required for diagnose command.");
    process.exit(1);
  }
  const config = getConfig();
  const appName = (flags["app-name"] as string) ?? config.APP_NAME;

  const result = diagnoseFrames(crashPath, symbolicatedPath, appName);
  console.log(JSON.stringify(result, null, 2));
}

function cmdListVersions(flags: Record<string, string | boolean>): void {
  const config = getConfig();
  const inputDir = (flags["input-dir"] as string) ?? config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const recursive = flags["recursive"] === true;
  const versions = listAvailableVersions(inputDir, recursive);
  console.log(JSON.stringify(versions, null, 2));
}

async function cmdPipeline(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const basicDir = path.join(config.CRASH_ANALYSIS_PARENT, "BasicCrashLogsFolder");
  const symbolicatedDir = path.join(config.CRASH_ANALYSIS_PARENT, "SymbolicatedCrashLogsFolder");
  const dsymPath = config.DSYM_PATH;
  const appPath = config.APP_PATH;
  const notify = flags["notify"] === true;
  const allThreads = flags["all-threads"] === true;
  const versions = flags["versions"]
    ? (flags["versions"] as string).split(",").map((v) => v.trim()).filter(Boolean)
    : (config.CRASH_VERSIONS?.split(",").map((v) => v.trim()).filter(Boolean) ?? []);
  const startDate = flags["start-date"] as string | undefined;
  const endDate = flags["end-date"] as string | undefined;

  // Step 1: export
  const { exportCrashLogs } = await import("./crashExporter.js");
  const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false, startDate, endDate);
  console.log("Export:", JSON.stringify(exportResult));

  // Step 2: symbolicate
  let symbolicationResult: unknown = null;
  if (dsymPath) {
    const appticsDir = getAppticsCrashesDir(config);
    const otherDir = getOtherCrashesDir(config);

    if (!hasCrashFiles(basicDir) && !hasCrashFiles(appticsDir) && !hasCrashFiles(otherDir)) {
      symbolicationResult = {
        skipped: true,
        reason: "No .crash or .ips files found in BasicCrashLogsFolder, AppticsCrashLogsFolder, or OtherCrashLogsFolder",
      };
    } else {
      let succeeded = 0;
      let failed = 0;
      let total = 0;
      const results: BatchResult[] = [];
      for (const dir of [basicDir, appticsDir, otherDir]) {
        const r = await runBatch(dir, dsymPath, appPath, symbolicatedDir, undefined, allThreads);
        succeeded += r.succeeded;
        failed += r.failed;
        total += r.total;
        results.push(...r.results);
      }
      symbolicationResult = { succeeded, failed, total, results };
    }
    console.log("Symbolication:", JSON.stringify(symbolicationResult));
  } else {
    console.log("Symbolication: skipped (DSYM_PATH not set)");
  }

  // Step 3: analyze
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  const fixStatuses: Record<string, { fixed: boolean; note?: string }> = {};
  for (const entry of tracker.getAll()) {
    fixStatuses[entry.signature] = { fixed: entry.fixed, note: entry.note };
  }
  const report = analyzeDirectory(symbolicatedDir, fixStatuses);
  console.log("Analysis:", JSON.stringify(report));

  // Step 4: notify
  if (notify) {
    const result = await sendCrashReportToCliq(report, config);
    console.log("Notification:", JSON.stringify(result));
    if (!result.success) {
      process.exit(1);
    }
  }
}

function cmdSetFix(signature: string, flags: Record<string, string | boolean>): void {
  const config = getConfig();
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  const note = flags["note"] as string | undefined;
  tracker.setFixed(signature, true, note);
  console.log(`Marked as fixed: ${signature}${note ? ` (note: ${note})` : ""}`);
}

function cmdUnsetFix(signature: string): void {
  const config = getConfig();
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  tracker.setFixed(signature, false);
  console.log(`Marked as unfixed: ${signature}`);
}

function cmdListFixes(): void {
  const config = getConfig();
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  console.log(JSON.stringify(tracker.getAll(), null, 2));
}

function cmdRemoveFix(signature: string): void {
  const config = getConfig();
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  tracker.remove(signature);
  console.log(`Removed fix tracking for: ${signature}`);
}

function printUsage(): void {
  console.log(`
CrashPoint iOS CLI — node dist/cli.js <command> [options]

Commands:
  export                Export .crash files from .xccrashpoint packages into BasicCrashLogsFolder
    --start-date <date> ISO date string to filter crashes from (e.g. 2026-03-01)
    --end-date <date>   ISO date string to filter crashes until (e.g. 2026-03-20)
  batch                 Symbolicate all crash files in BasicCrashLogsFolder
    --all-threads       Symbolicate all threads (not just crashed thread)
  analyze               Group and deduplicate crashes into a report
    --crash-dir <dir>   Directory of crash files (default: SymbolicatedCrashLogsFolder)
    -o <output.json>    Write report JSON to file (default: stdout)
  notify                Send a crash report JSON to Zoho Cliq
    --report <file>     Path to crash report JSON file
  notify-unfixed        Analyze crashes, filter to unfixed only, and send filtered report to Cliq
    --crash-dir <dir>   Directory of symbolicated crash files (default: SymbolicatedCrashLogsFolder)
    --dry-run           Analyze and filter but don't send to Cliq
    -o <output.json>    Write the filtered report JSON to a file
  setup                 Create full folder structure + symlinks
    --master-branch     Path to master/live branch checkout
    --dev-branch        Path to development branch checkout
    --dsym              Path to .dSYM bundle
    --app               Path to .app bundle
    --crash-logs        Directory to copy existing crash files from
  symbolicate-one       Symbolicate a single crash file
    --crash <path>      Path to .crash file (required)
    --dsym <path>       Path to .dSYM bundle (overrides env)
    --app <path>        Path to .app bundle (overrides env)
    --output <path>     Write symbolicated output to file (default: stdout)
    --all-threads       Symbolicate all threads (not just crashed thread)
  diagnose              Frame-by-frame symbolication quality check
    --crash <path>      Path to original .crash file (required)
    --symbolicated <path>  Path to symbolicated .crash file (required)
    --app-name <name>   App binary name filter (overrides env)
  list-versions         List versions found in .xccrashpoint files
    --input-dir <dir>   Directory to search (default: CRASH_INPUT_DIR or CRASH_ANALYSIS_PARENT)
    --recursive         Search recursively
  pipeline              Full export → symbolicate → analyze → (optionally) notify
    --notify            Send Cliq notification after analysis
    --all-threads       Symbolicate all threads (not just crashed thread)
    --versions v1,v2    Comma-separated version filter
    --start-date <date> ISO date string to filter crashes from (e.g. 2026-03-01)
    --end-date <date>   ISO date string to filter crashes until (e.g. 2026-03-20)
  set-fix <signature>   Mark crash signature as fixed
    --note <text>       Optional note
  unset-fix <signature> Mark crash signature as unfixed
  list-fixes            List all tracked fix statuses
  remove-fix <signature> Remove fix tracking entry

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
      case "notify":
        await cmdNotify(flags);
        break;
      case "notify-unfixed":
        await cmdNotifyUnfixed(flags);
        break;
      case "setup":
        await cmdSetup(flags);
        break;
      case "symbolicate-one":
        await cmdSymbolicateOne(flags);
        break;
      case "diagnose":
        cmdDiagnose(flags);
        break;
      case "list-versions":
        cmdListVersions(flags);
        break;
      case "pipeline":
        await cmdPipeline(flags);
        break;
      case "set-fix": {
        const signature = args[0];
        if (!signature) {
          console.error("Error: set-fix requires a signature argument.");
          process.exit(1);
        }
        cmdSetFix(signature, parseFlags(args.slice(1)));
        break;
      }
      case "unset-fix": {
        const signature = args[0];
        if (!signature) {
          console.error("Error: unset-fix requires a signature argument.");
          process.exit(1);
        }
        cmdUnsetFix(signature);
        break;
      }
      case "list-fixes":
        cmdListFixes();
        break;
      case "remove-fix": {
        const signature = args[0];
        if (!signature) {
          console.error("Error: remove-fix requires a signature argument.");
          process.exit(1);
        }
        cmdRemoveFix(signature);
        break;
      }
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
