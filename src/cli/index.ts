#!/usr/bin/env node

export { parseFlags } from "./parseFlags.js";
export { cmdExport } from "./cmdExport.js";
export { cmdBatch } from "./cmdBatch.js";
export { cmdAnalyze } from "./cmdAnalyze.js";
export { cmdSetup } from "./cmdSetup.js";
export { cmdSymbolicateOne } from "./cmdSymbolicateOne.js";
export { cmdDiagnose } from "./cmdDiagnose.js";
export { cmdListVersions } from "./cmdListVersions.js";
export { cmdPipeline } from "./cmdPipeline.js";
export { cmdSearch } from "./cmdSearch.js";
export { cmdClean } from "./cmdClean.js";
export { cmdVerifyDsym } from "./cmdVerifyDsym.js";
export { cmdSetFix, cmdUnsetFix, cmdListFixes } from "./cmdFixStatus.js";

import { parseFlags } from "./parseFlags.js";
import { cmdExport } from "./cmdExport.js";
import { cmdBatch } from "./cmdBatch.js";
import { cmdAnalyze } from "./cmdAnalyze.js";
import { cmdSetup } from "./cmdSetup.js";
import { cmdSymbolicateOne } from "./cmdSymbolicateOne.js";
import { cmdDiagnose } from "./cmdDiagnose.js";
import { cmdListVersions } from "./cmdListVersions.js";
import { cmdPipeline } from "./cmdPipeline.js";
import { cmdSearch } from "./cmdSearch.js";
import { cmdClean } from "./cmdClean.js";
import { cmdVerifyDsym } from "./cmdVerifyDsym.js";
import { cmdSetFix, cmdUnsetFix, cmdListFixes } from "./cmdFixStatus.js";

const [, , command, ...args] = process.argv;

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
  pipeline              Full export → symbolicate → analyze
    --versions v1,v2    Comma-separated version filter
    --start-date <date> ISO date string to filter crashes from (e.g. 2026-03-01)
    --end-date <date>   ISO date string to filter crashes until (e.g. 2026-03-20)
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
