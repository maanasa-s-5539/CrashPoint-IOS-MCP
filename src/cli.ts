#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getConfig, getBasicCrashesDir, getSymbolicatedDir } from "./config.js";
import { exportCrashLogs } from "./crashExporter.js";
import { runBatch } from "./symbolicator.js";
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

function printUsage(): void {
  console.log(`
CrashPoint iOS CLI — node dist/cli.js <command> [options]

Commands:
  export                Export .crash files from .xccrashpoint packages into BasicCrashLogsFolder
  batch                 Symbolicate all crash files in BasicCrashLogsFolder
  analyze               Group and deduplicate crashes into a report
    --crash-dir <dir>   Directory of crash files (default: SymbolicatedCrashLogsFolder)
    -o <output.json>    Write report JSON to file (default: stdout)
  notify                Send a crash report JSON to Zoho Cliq
    --report <file>     Path to crash report JSON file
  notify-unfixed        Analyze crashes, filter to unfixed only, and send filtered report to Cliq
    --crash-dir <dir>   Directory of symbolicated crash files (default: SymbolicatedCrashLogsFolder)
    --dry-run           Analyze and filter but don't send to Cliq
    -o <output.json>    Write the filtered report JSON to a file

Environment variables: see .env.example
`);
}

(async () => {
  try {
    const flags = parseFlags(args);

    switch (command) {
      case "export":
        await cmdExport();
        break;
      case "batch":
        await cmdBatch();
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
