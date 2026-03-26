#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getConfig, getXcodeCrashesDir, getMainCrashLogsDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, hasCrashFiles } from "./config.js";
import { exportCrashLogs } from "./crashExporter.js";
import { runBatch, symbolicateOne, diagnoseFrames, BatchResult } from "./symbolicator.js";
import { analyzeDirectory, readCrash, searchCrashes, cleanOldCrashes } from "./crashAnalyzer.js";
import { sendCrashReportToCliq } from "./cliqNotifier.js";
import { FixTracker } from "./fixTracker.js";
import { listAvailableVersions } from "./crashExporter.js";
import { assertPathUnderBase, assertNoTraversal, assertSafeSymlinkTarget } from "./pathSafety.js";
import { ProcessedManifest } from "./processedManifest.js";

const execFileAsync = promisify(execFile);

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
  const outputDir = getXcodeCrashesDir(config);
  const versions = config.CRASH_VERSIONS?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
  const startDate = flags["start-date"] as string | undefined;
  const endDate = flags["end-date"] as string | undefined;
  const dryRun = flags["dry-run"] === true;
  const includeProcessed = flags["include-processed"] === true;
  const manifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);
  const result = exportCrashLogs(inputDir, outputDir, versions, false, dryRun, startDate, endDate, manifest);
  console.log(JSON.stringify(result, null, 2));
}

async function cmdBatch(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const crashDir = getXcodeCrashesDir(config);
  const appticsDir = getAppticsCrashesDir(config);
  const otherDir = getOtherCrashesDir(config);
  const outputDir = getSymbolicatedDir(config);
  const dsymPath = config.DSYM_PATH;
  const includeProcessed = flags["include-processed"] === true;
  const manifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);

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
        message: "No .crash or .ips files found in MainCrashLogsFolder/XCodeCrashLogs, MainCrashLogsFolder/AppticsCrashLogs, or MainCrashLogsFolder/OtherCrashLogs",
      }, null, 2)
    );
    return;
  }

  let succeeded = 0;
  let failed = 0;
  let total = 0;
  const results: BatchResult[] = [];

  for (const dir of [crashDir, appticsDir, otherDir]) {
    const r = await runBatch(dir, dsymPath, outputDir, manifest);
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
  const includeProcessed = flags["include-processed"] === true;
  const manifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);

  if (outputFile) {
    assertPathUnderBase(outputFile, config.CRASH_ANALYSIS_PARENT);
  }

  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  const fixStatuses: Record<string, { fixed: boolean; note?: string }> = {};
  for (const entry of tracker.getAll()) {
    fixStatuses[entry.signature] = { fixed: entry.fixed, note: entry.note };
  }

  const report = analyzeDirectory(crashDir, fixStatuses, manifest);

  const json = JSON.stringify(report, null, 2);
  if (outputFile) {
    fs.writeFileSync(outputFile, json, "utf-8");
    console.log(`Report written to ${path.resolve(outputFile)}`);
  } else {
    console.log(json);
  }
}

async function cmdNotify(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const crashDir = (flags["crash-dir"] as string) ?? getSymbolicatedDir(config);
  const unfixedOnly = flags["unfixed-only"] === true;
  const dryRun = flags["dry-run"] === true;
  const outputFile = (flags["o"] as string) ?? undefined;

  if (outputFile) {
    assertPathUnderBase(outputFile, config.CRASH_ANALYSIS_PARENT);
  }

  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  const fixStatuses: Record<string, { fixed: boolean; note?: string }> = {};
  for (const entry of tracker.getAll()) {
    fixStatuses[entry.signature] = { fixed: entry.fixed, note: entry.note };
  }

  const fullReport = analyzeDirectory(crashDir, fixStatuses);

  let reportToSend = fullReport;

  if (unfixedOnly) {
    const fixedGroups = fullReport.crash_groups.filter((g) => g.fix_status?.fixed === true);
    const unfixedGroups = fullReport.crash_groups.filter(
      (g) => !g.fix_status || g.fix_status.fixed === false
    );
    reportToSend = {
      ...fullReport,
      report_type: "unfixed-only",
      crash_groups: unfixedGroups.map((g, idx) => ({ ...g, rank: idx + 1 })),
      total_crashes: unfixedGroups.reduce((sum, g) => sum + g.count, 0),
      unique_crash_types: unfixedGroups.length,
    };
    console.log(
      `Unfixed: ${unfixedGroups.length} type(s), Fixed: ${fixedGroups.length} type(s)`
    );
  }

  if (dryRun) {
    if (outputFile) {
      fs.writeFileSync(outputFile, JSON.stringify(reportToSend, null, 2), "utf-8");
      console.log(`Report written to ${path.resolve(outputFile)}`);
    } else {
      console.log(JSON.stringify(reportToSend, null, 2));
    }
    console.log("Dry-run: no notification sent to Cliq.");
    return;
  }

  if (reportToSend.unique_crash_types === 0) {
    console.log(unfixedOnly ? "No unfixed crashes to report. Skipping Cliq notification." : "No crashes to report. Skipping Cliq notification.");
    return;
  }

  const result = await sendCrashReportToCliq(reportToSend, config);
  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify(reportToSend, null, 2), "utf-8");
    console.log(`Report written to ${path.resolve(outputFile)}`);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) {
    process.exit(1);
  }
}

async function cmdSetup(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const parentDir = config.CRASH_ANALYSIS_PARENT;
  const mainCrashDir = getMainCrashLogsDir(config);
  const xcodeCrashDir = getXcodeCrashesDir(config);
  const appticsDir = getAppticsCrashesDir(config);
  const otherDir = getOtherCrashesDir(config);
  const symbolicatedDir = path.join(parentDir, "SymbolicatedCrashLogsFolder");

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
        fs.copyFileSync(path.join(existingCrashLogsDir, file), path.join(xcodeCrashDir, file));
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
  const outputPath = (flags["output"] as string) ?? path.join(config.CRASH_ANALYSIS_PARENT, "SymbolicatedCrashLogsFolder", path.basename(crashPath));

  if (flags["output"]) {
    assertPathUnderBase(outputPath, config.CRASH_ANALYSIS_PARENT);
  }

  if (!dsymPath) {
    console.error("Error: --dsym or DSYM_PATH env var is required.");
    process.exit(1);
  }

  const result = await symbolicateOne(crashPath, dsymPath, outputPath);
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
  const basicDir = getXcodeCrashesDir(config);
  const symbolicatedDir = path.join(config.CRASH_ANALYSIS_PARENT, "SymbolicatedCrashLogsFolder");
  const dsymPath = config.DSYM_PATH;
  const notify = flags["notify"] === true;
  const includeProcessed = flags["include-processed"] === true;
  const manifest = includeProcessed ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);
  const versions = flags["versions"]
    ? (flags["versions"] as string).split(",").map((v) => v.trim()).filter(Boolean)
    : (config.CRASH_VERSIONS?.split(",").map((v) => v.trim()).filter(Boolean) ?? []);
  const startDate = flags["start-date"] as string | undefined;
  const endDate = flags["end-date"] as string | undefined;

  // Step 1: export
  const { exportCrashLogs } = await import("./crashExporter.js");
  const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false, startDate, endDate, manifest);
  console.log("Export:", JSON.stringify(exportResult));

  // Step 2: symbolicate
  let symbolicationResult: unknown = null;
  if (dsymPath) {
    const appticsDir = getAppticsCrashesDir(config);
    const otherDir = getOtherCrashesDir(config);

    if (!hasCrashFiles(basicDir) && !hasCrashFiles(appticsDir) && !hasCrashFiles(otherDir)) {
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
        const r = await runBatch(dir, dsymPath, symbolicatedDir, manifest);
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
  const report = analyzeDirectory(symbolicatedDir, fixStatuses, manifest);
  const reportFile = path.join(config.CRASH_ANALYSIS_PARENT, `report_${Date.now()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), "utf-8");
  console.log("Analysis:", JSON.stringify(report));
  console.log(`Report saved to: ${reportFile}`);

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

function cmdRead(flags: Record<string, string | boolean>): void {
  const crashPath = flags["crash"] as string;
  if (!crashPath) {
    console.error("Error: --crash <path> is required for read command.");
    process.exit(1);
  }
  assertNoTraversal(crashPath);
  const meta = readCrash(crashPath);
  if (!meta) {
    console.error(`Error: Could not read or parse crash file: ${crashPath}`);
    process.exit(1);
  }
  console.log(JSON.stringify(meta, null, 2));
}

function cmdSearch(flags: Record<string, string | boolean>): void {
  const query = flags["query"] as string;
  if (!query) {
    console.error("Error: --query <term> is required for search command.");
    process.exit(1);
  }
  const config = getConfig();
  const crashDir = (flags["crash-dir"] as string) ?? getSymbolicatedDir(config);
  const result = searchCrashes(query, crashDir);
  console.log(JSON.stringify(result, null, 2));
}

function cmdClean(flags: Record<string, string | boolean>): void {
  const beforeDate = flags["before-date"] as string;
  if (!beforeDate) {
    console.error("Error: --before-date <ISO date> is required for clean command.");
    process.exit(1);
  }
  const dryRun = flags["dry-run"] === true;
  const config = getConfig();

  const dirs = [
    getXcodeCrashesDir(config),
    getAppticsCrashesDir(config),
    getOtherCrashesDir(config),
    getSymbolicatedDir(config),
  ];

  const result = cleanOldCrashes(beforeDate, dirs, dryRun, config.CRASH_ANALYSIS_PARENT);
  console.log(JSON.stringify(result, null, 2));
  if (dryRun) {
    console.log(`Dry-run: ${result.deleted} file(s) would be deleted, ${result.skipped} skipped.`);
  } else {
    console.log(`Deleted ${result.deleted} file(s), skipped ${result.skipped}.`);
  }
}

async function cmdVerifyDsym(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const flagDsym = flags["dsym"] as string | undefined;
  const crashPath = flags["crash"] as string | undefined;
  const crashDir = flags["crash-dir"] as string | undefined;

  const hasDsymFlag = Boolean(flagDsym);
  const hasCrashFlag = Boolean(crashPath || crashDir);

  // Both-or-neither: if only one side is provided, error out
  if (hasDsymFlag && !hasCrashFlag) {
    console.error("Error: --dsym requires --crash or --crash-dir to also be provided. Either supply both or neither.");
    process.exit(1);
  }
  if (!hasDsymFlag && hasCrashFlag) {
    console.error("Error: --crash/--crash-dir requires --dsym to also be provided. Either supply both or neither.");
    process.exit(1);
  }

  // Resolve dSYM path
  let dsymPath: string;
  if (flagDsym) {
    dsymPath = flagDsym;
  } else if (config.DSYM_PATH) {
    dsymPath = config.DSYM_PATH;
  } else {
    const symlinkPath = path.join(config.CRASH_ANALYSIS_PARENT, "dSYM_File");
    try {
      dsymPath = fs.realpathSync(symlinkPath);
    } catch {
      console.error("Error: No dSYM path available. Provide --dsym, set DSYM_PATH env var, or run setup to create the dSYM_File symlink in CRASH_ANALYSIS_PARENT.");
      process.exit(1);
    }
  }

  assertNoTraversal(dsymPath);

  if (!fs.existsSync(dsymPath)) {
    console.error(`Error: dSYM not found at: ${dsymPath}`);
    process.exit(1);
  }

  // Resolve symlink before passing to dwarfdump
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
    console.error(`Error: dwarfdump failed: ${msg}`);
    process.exit(1);
  }

  const uuidLineRe = /UUID:\s+([0-9A-F-]+)\s+\(([^)]+)\)/gi;
  const dsymUuids: Array<{ arch: string; uuid: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = uuidLineRe.exec(dwarfOutput)) !== null) {
    dsymUuids.push({ uuid: match[1].toUpperCase(), arch: match[2] });
  }

  // Collect crash files
  const crashFiles: string[] = [];
  if (hasCrashFlag) {
    // User explicitly provided crash flags
    if (crashPath) {
      assertNoTraversal(crashPath);
      crashFiles.push(crashPath);
    }
    if (crashDir) {
      if (fs.existsSync(crashDir)) {
        fs.readdirSync(crashDir)
          .filter((f) => f.endsWith(".crash") || f.endsWith(".ips"))
          .forEach((f) => crashFiles.push(path.join(crashDir, f)));
      }
    }
  } else {
    // Default: collect from all three subdirectories of MainCrashLogsFolder
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
    console.log(JSON.stringify({ valid: true, dsymPath, dsymUuids, detail: `dSYM is valid. Found ${dsymUuids.length} UUID(s). No crash files found for UUID comparison.` }, null, 2));
    return;
  }

  const binaryImgRe = /^\s*0x[0-9a-fA-F]+\s+-\s+0x[0-9a-fA-F]+\s+\S+\s+\S+\s+<([0-9a-f]{32})>/gim;
  const crashFileUuids: Array<{ file: string; uuid: string }> = [];

  for (const cf of crashFiles) {
    let content = "";
    try {
      content = fs.readFileSync(cf, "utf-8");
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
        crashFileUuids.push({ file: path.basename(cf), uuid });
      }
    }
  }

  const matches: Array<{ uuid: string; arch: string; matchedFiles: string[] }> = [];
  const mismatches: string[] = [];

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
  const detail = matches.length > 0
    ? `${matches.length} UUID match(es) found. ${mismatches.length > 0 ? `${mismatches.length} mismatch(es).` : "All UUIDs matched."}`
    : `No UUID matches found. Symbolication will likely fail — ensure the correct dSYM for this build is used.`;

  console.log(JSON.stringify({ valid, dsymPath, dsymUuids, crashFileUuids, matches, mismatches, detail }, null, 2));
}

function printUsage(): void {
  console.log(`
CrashPoint iOS CLI — node dist/cli.js <command> [options]

Commands:
  export                Export .crash files from .xccrashpoint packages into MainCrashLogsFolder/XCodeCrashLogs
    --dry-run           Preview what would be exported without writing files
    --start-date <date> ISO date string to filter crashes from (e.g. 2026-03-01)
    --end-date <date>   ISO date string to filter crashes until (e.g. 2026-03-20)
  batch                 Symbolicate all crash files in MainCrashLogsFolder (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs)
                        using Xcode's symbolicatecrash tool
  analyze               Group and deduplicate crashes into a report
    --crash-dir <dir>   Directory of crash files (default: SymbolicatedCrashLogsFolder)
    -o <output.json>    Write report JSON to file (default: stdout)
  notify                Analyze crashes and send report to Zoho Cliq
    --crash-dir <dir>   Directory of symbolicated crash files (default: SymbolicatedCrashLogsFolder)
    --unfixed-only      Send only unfixed crash types to Cliq
    --dry-run           Analyze but don't send to Cliq
    -o <output.json>    Write the report JSON to a file
  setup                 Create full folder structure + symlinks
    --master-branch     Path to master/live branch checkout
    --dev-branch        Path to development branch checkout
    --dsym              Path to .dSYM bundle
    --app               Path to .app bundle
    --crash-logs        Directory to copy existing crash files from
  symbolicate-one       Symbolicate a single crash file using Xcode's symbolicatecrash tool
    --crash <path>      Path to .crash file (required)
    --dsym <path>       Path to .dSYM bundle (overrides env)
    --output <path>     Write symbolicated output to file
  diagnose              Frame-by-frame symbolication quality check
    --crash <path>      Path to original .crash file (required)
    --symbolicated <path>  Path to symbolicated .crash file (required)
    --app-name <name>   App binary name filter (overrides env)
  list-versions         List versions found in .xccrashpoint files
    --input-dir <dir>   Directory to search (default: CRASH_INPUT_DIR or CRASH_ANALYSIS_PARENT)
    --recursive         Search recursively
  pipeline              Full export → symbolicate → analyze → (optionally) notify
    --notify            Send Cliq notification after analysis
    --versions v1,v2    Comma-separated version filter
    --start-date <date> ISO date string to filter crashes from (e.g. 2026-03-01)
    --end-date <date>   ISO date string to filter crashes until (e.g. 2026-03-20)
  read                  Parse and summarize a single crash file
    --crash <path>      Path to .crash or .ips file (required)
  search                Search crash files for a keyword or pattern
    --query <term>      Search term (required, case-insensitive)
    --crash-dir <dir>   Directory to search (default: SymbolicatedCrashLogsFolder)
  clean                 Delete crash files older than a given date
    --before-date <date> ISO date — files with crash dates before this are deleted (required)
    --dry-run           Preview what would be deleted without deleting
  verify-dsym           Validate a .dSYM bundle and check UUID matches against crash files
                        With no flags: dSYM is resolved from the dSYM_File symlink in CRASH_ANALYSIS_PARENT,
                        and crashes are collected from all MainCrashLogsFolder subfolders automatically.
                        --dsym and --crash/--crash-dir must be provided together, or neither.
    --dsym <path>       Path to .dSYM bundle (overrides DSYM_PATH env var and dSYM_File symlink)
    --crash <path>      Path to a single .crash or .ips file to compare UUIDs against
    --crash-dir <dir>   Directory of crash files to compare UUIDs against
  set-fix <signature>   Mark crash signature as fixed
    --note <text>       Optional note
  unset-fix <signature> Mark crash signature as unfixed
  list-fixes            List all tracked fix statuses

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
      case "read":
        cmdRead(flags);
        break;
      case "search":
        cmdSearch(flags);
        break;
      case "clean":
        cmdClean(flags);
        break;
      case "verify-dsym":
        await cmdVerifyDsym(flags);
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
