#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getConfig, getBasicCrashesDir, getSymbolicatedDir } from "./config.js";
import { exportCrashLogs, listAvailableVersions } from "./crashExporter.js";
import { runBatch, symbolicateOne, diagnoseFrames } from "./symbolicator.js";
import { analyzeDirectory } from "./crashAnalyzer.js";
import { sendCrashReportToCliq } from "./cliqNotifier.js";
import { FixTracker } from "./fixTracker.js";

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

async function cmdExport(): Promise<void> {
  const config = getConfig();
  const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const outputDir = getBasicCrashesDir(config);
  const versions = config.CRASH_VERSIONS?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  const result = exportCrashLogs(inputDir, outputDir, versions, false, false);
  console.log(JSON.stringify(result, null, 2));
}

async function cmdBatch(): Promise<void> {
  const config = getConfig();
  const crashDir = getBasicCrashesDir(config);
  const outputDir = getSymbolicatedDir(config);
  const dsymPath = config.DSYM_PATH;
  const appPath = config.APP_PATH;

  if (!dsymPath) {
    console.error("Error: DSYM_PATH env var is required for batch symbolication.");
    process.exit(1);
  }

  const result = await runBatch(crashDir, dsymPath, appPath, outputDir);
  console.log(JSON.stringify(result, null, 2));
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
  const parentDir = (flags["parent"] as string) ?? config.CRASH_ANALYSIS_PARENT;

  if (!parentDir) {
    console.error("Error: --parent or CRASH_ANALYSIS_PARENT env var is required.");
    process.exit(1);
  }

  const basicDir = path.join(parentDir, "BasicCrashLogsFolder");
  const symbolicatedDir = path.join(parentDir, "SymbolicatedCrashLogsFolder");

  // Create real directories
  for (const dir of [parentDir, basicDir, symbolicatedDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`  ✅ Created: ${dir}`);
    } else {
      console.log(`  ℹ️  Exists:  ${dir}`);
    }
  }

  // Define symlinks to create
  const symlinkDefs: Array<{ name: string; target: string | undefined }> = [
    { name: "CurrentMasterLiveBranch", target: (flags["master"] as string) ?? config.MASTER_BRANCH_PATH },
    { name: "CurrentDevelopmentBranch", target: (flags["dev"] as string) ?? config.DEV_BRANCH_PATH },
    { name: "dSYM_File", target: (flags["dsym"] as string) ?? config.DSYM_PATH },
    { name: "app_File", target: (flags["app"] as string) ?? config.APP_PATH },
  ];

  for (const { name, target } of symlinkDefs) {
    if (!target) {
      console.log(`  ℹ️  Skipping ${name} — no path provided`);
      continue;
    }
    const linkPath = path.join(parentDir, name);
    // Remove stale symlink or existing entry
    try {
      fs.lstatSync(linkPath);
      fs.rmSync(linkPath, { force: true });
    } catch {
      // doesn't exist — nothing to remove
    }
    try {
      fs.symlinkSync(target, linkPath);
      if (!fs.existsSync(target)) {
        console.log(`  ⚠️  ${name} -> ${target} (target does not exist yet)`);
      } else {
        console.log(`  ✅ ${name} -> ${target}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ Failed to create symlink ${name}: ${msg}`);
    }
  }

  // Copy crash files if --crash-logs provided
  const crashLogsDir = flags["crash-logs"] as string;
  if (crashLogsDir) {
    let copied = 0;
    try {
      const files = fs.readdirSync(crashLogsDir).filter(
        (f) => f.endsWith(".crash") || f.endsWith(".ips")
      );
      for (const file of files) {
        fs.copyFileSync(path.join(crashLogsDir, file), path.join(basicDir, file));
        copied++;
      }
      console.log(`  ✅ Copied ${copied} crash file(s) from ${crashLogsDir} → BasicCrashLogsFolder`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ⚠️  Could not copy crash files: ${msg}`);
    }
  }

  console.log(`\nFolder structure:\n${parentDir}/`);
  try {
    const entries = fs.readdirSync(parentDir);
    for (const entry of entries) {
      const entryPath = path.join(parentDir, entry);
      try {
        const stat = fs.lstatSync(entryPath);
        if (stat.isSymbolicLink()) {
          const target = fs.readlinkSync(entryPath);
          console.log(`  ├── ${entry} -> ${target}`);
        } else if (stat.isDirectory()) {
          console.log(`  ├── ${entry}/`);
        } else {
          console.log(`  ├── ${entry}`);
        }
      } catch {
        console.log(`  ├── ${entry}`);
      }
    }
  } catch {
    // ignore listing errors
  }
}

async function cmdSymbolicateOne(flags: Record<string, string | boolean>): Promise<void> {
  const crashPath = flags["crash"] as string;
  if (!crashPath) {
    console.error("Error: --crash <path> is required for symbolicate-one command.");
    process.exit(1);
  }

  const config = getConfig();
  const dsymPath = config.DSYM_PATH;
  const appPath = config.APP_PATH;

  if (!dsymPath) {
    console.error("Error: DSYM_PATH env var is required for symbolication.");
    process.exit(1);
  }

  const outputPath = path.join(getSymbolicatedDir(config), path.basename(crashPath));
  const result = await symbolicateOne(
    crashPath,
    dsymPath,
    appPath,
    outputPath,
    undefined,
    flags["all-threads"] === true
  );
  console.log(JSON.stringify(result, null, 2));
}

async function cmdDiagnose(flags: Record<string, string | boolean>): Promise<void> {
  const crashPath = flags["crash"] as string;
  if (!crashPath) {
    console.error("Error: --crash <path> is required for diagnose command.");
    process.exit(1);
  }

  const config = getConfig();
  const dsymPath = config.DSYM_PATH;
  const appPath = config.APP_PATH;

  if (!dsymPath) {
    console.error("Error: DSYM_PATH env var is required for diagnose command.");
    process.exit(1);
  }

  const result = await diagnoseFrames(crashPath, dsymPath, appPath);
  console.log(JSON.stringify(result, null, 2));
}

async function cmdListVersions(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const inputDir = (flags["input-dir"] as string) ?? config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const versions = listAvailableVersions(inputDir);
  console.log(JSON.stringify({ versions }, null, 2));
}

async function cmdPipeline(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const basicDir = getBasicCrashesDir(config);
  const symbolicatedDir = getSymbolicatedDir(config);
  const dsymPath = config.DSYM_PATH;
  const appPath = config.APP_PATH;
  const shouldNotify = flags["notify"] === true;
  const versionsStr = flags["versions"] as string | undefined;
  const versions = versionsStr ? versionsStr.split(",").map((v) => v.trim()).filter(Boolean) : [];

  console.log("── Step 1: Export crash logs ──────────────────────");
  const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
  const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false);
  console.log(`  Exported: ${exportResult.exported}, Skipped: ${exportResult.skipped}`);

  if (dsymPath) {
    console.log("── Step 2: Batch symbolicate ───────────────────────");
    const batchResult = await runBatch(basicDir, dsymPath, appPath, symbolicatedDir);
    console.log(`  Succeeded: ${batchResult.succeeded}, Failed: ${batchResult.failed}`);
  } else {
    console.log("── Step 2: Skipping symbolication (DSYM_PATH not set) ─");
  }

  console.log("── Step 3: Analyze crashes ─────────────────────────");
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  const fixStatuses: Record<string, { fixed: boolean; note?: string }> = {};
  for (const entry of tracker.getAll()) {
    fixStatuses[entry.signature] = { fixed: entry.fixed, note: entry.note };
  }
  const report = analyzeDirectory(symbolicatedDir, fixStatuses);
  console.log(`  Crash groups: ${report.unique_crash_types}, Total crashes: ${report.total_crashes}`);

  if (shouldNotify) {
    console.log("── Step 4: Send Cliq notification ──────────────────");
    const result = await sendCrashReportToCliq(report, config);
    console.log(`  Cliq: ${result.success ? "✅ sent" : "❌ " + result.message}`);
    if (!result.success) process.exit(1);
  }

  console.log("\nPipeline complete.");
  console.log(JSON.stringify(report, null, 2));
}

function cmdSetFixStatus(flags: Record<string, string | boolean>, posArgs: string[], fixed: boolean): void {
  const signature = posArgs[0];
  if (!signature) {
    console.error(`Error: <signature> is required.`);
    process.exit(1);
  }
  const config = getConfig();
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  const note = flags["note"] as string | undefined;
  const status = tracker.setFixed(signature, fixed, note);
  console.log(JSON.stringify({ signature, ...status }, null, 2));
}

function cmdListFixes(): void {
  const config = getConfig();
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  const entries = tracker.getAll();
  console.log(JSON.stringify(entries, null, 2));
}

function cmdRemoveFix(posArgs: string[]): void {
  const signature = posArgs[0];
  if (!signature) {
    console.error("Error: <signature> is required.");
    process.exit(1);
  }
  const config = getConfig();
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  const removed = tracker.remove(signature);
  if (removed) {
    console.log(`Removed fix tracking for: ${signature}`);
  } else {
    console.log(`No fix tracking found for: ${signature}`);
  }
}

function printUsage(): void {
  console.log(`
CrashPoint iOS CLI — node dist/cli.js <command> [options]

Commands:
  setup                 Create the full ParentHolderFolder structure with symlinks
    --parent <path>     Parent folder (default: CRASH_ANALYSIS_PARENT env var)
    --master <path>     Master branch path (default: MASTER_BRANCH_PATH env var)
    --dev <path>        Dev branch path (default: DEV_BRANCH_PATH env var)
    --dsym <path>       dSYM path (default: DSYM_PATH env var)
    --app <path>        .app path (default: APP_PATH env var)
    --crash-logs <dir>  Copy .crash/.ips files from this dir into BasicCrashLogsFolder

  export                Export .crash files from .xccrashpoint packages into BasicCrashLogsFolder
  batch                 Symbolicate all crash files in BasicCrashLogsFolder
  symbolicate-one       Symbolicate a single crash file
    --crash <path>      Path to the .crash or .ips file (required)
    --all-threads       Symbolicate all threads (default: crashed thread only)
  diagnose              Verify symbolication quality for a single crash file
    --crash <path>      Path to the crash file (required)
  list-versions         List app versions found in .xccrashpoint files
    --input-dir <dir>   Directory to search (default: CRASH_INPUT_DIR or CRASH_ANALYSIS_PARENT)
  analyze               Group and deduplicate crashes into a report
    --crash-dir <dir>   Directory of crash files (default: SymbolicatedCrashLogsFolder)
    -o <output.json>    Write report JSON to file (default: stdout)
  notify                Send a crash report JSON to Zoho Cliq
    --report <file>     Path to crash report JSON file
  notify-unfixed        Analyze crashes, filter to unfixed only, and send filtered report to Cliq
    --crash-dir <dir>   Directory of symbolicated crash files (default: SymbolicatedCrashLogsFolder)
    --dry-run           Analyze and filter but don't send to Cliq
    -o <output.json>    Write the filtered report JSON to a file
  pipeline              Run the full pipeline: export → batch symbolicate → analyze → notify
    --notify            Send the report to Cliq after analysis
    --versions <v1,v2>  Filter to specific app versions (comma-separated)

  set-fix <signature>   Mark a crash signature as fixed in development
    --note <text>       Optional note about the fix
  unset-fix <signature> Mark a crash signature as unfixed
  list-fixes            List all fix statuses
  remove-fix <signature> Remove fix tracking for a signature

Environment variables: see .env.example
`);
}

(async () => {
  try {
    const flags = parseFlags(args);
    // Positional args (non-flag arguments after the command)
    const posArgs = args.filter((a) => !a.startsWith("-") && a !== (flags["note"] as string));

    switch (command) {
      case "setup":
        await cmdSetup(flags);
        break;
      case "export":
        await cmdExport();
        break;
      case "batch":
        await cmdBatch();
        break;
      case "symbolicate-one":
        await cmdSymbolicateOne(flags);
        break;
      case "diagnose":
        await cmdDiagnose(flags);
        break;
      case "list-versions":
        await cmdListVersions(flags);
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
      case "pipeline":
        await cmdPipeline(flags);
        break;
      case "set-fix":
        cmdSetFixStatus(flags, posArgs, true);
        break;
      case "unset-fix":
        cmdSetFixStatus(flags, posArgs, false);
        break;
      case "list-fixes":
        cmdListFixes();
        break;
      case "remove-fix":
        cmdRemoveFix(posArgs);
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
