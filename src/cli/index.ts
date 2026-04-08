#!/usr/bin/env node

export { parseFlags } from "./parseFlags.js";
export { cmdExport } from "./cmdExport.js";
export { cmdBatch } from "./cmdBatch.js";
export { cmdAnalyze } from "./cmdAnalyze.js";
export { cmdSetup } from "./cmdSetup.js";
export { cmdListVersions } from "./cmdListVersions.js";
export { cmdPipeline } from "./cmdPipeline.js";
export { cmdClean } from "./cmdClean.js";
export { cmdVerifyDsym } from "./cmdVerifyDsym.js";
export { cmdFixStatus } from "./cmdFixStatus.js";

import { parseFlags } from "./parseFlags.js";
import { cmdExport } from "./cmdExport.js";
import { cmdBatch } from "./cmdBatch.js";
import { cmdAnalyze } from "./cmdAnalyze.js";
import { cmdSetup } from "./cmdSetup.js";
import { cmdListVersions } from "./cmdListVersions.js";
import { cmdPipeline } from "./cmdPipeline.js";
import { cmdClean } from "./cmdClean.js";
import { cmdVerifyDsym } from "./cmdVerifyDsym.js";
import { cmdFixStatus } from "./cmdFixStatus.js";

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
    --file <path>       Symbolicate only this single .crash file instead of batch processing all directories
  analyze               Group and deduplicate crashes into a report (auto-saves JSON + CSV to AnalyzedReportsFolder)
  setup                 Create full folder structure + symlinks
    --master-branch     Path to master/live branch checkout
    --dev-branch        Path to development branch checkout
    --dsym              Path to .dSYM bundle
    --app               Path to .app bundle
  list-versions         List versions found in .xccrashpoint files
    --input-dir <dir>   Directory to search (default: CRASH_INPUT_DIR or CRASH_ANALYSIS_PARENT)
    --recursive         Search recursively
  pipeline              Full export → symbolicate → analyze
    --versions v1,v2    Comma-separated version filter
    --start-date <date> ISO date string to filter crashes from (e.g. 2026-03-01)
    --end-date <date>   ISO date string to filter crashes until (e.g. 2026-03-20)
  clean                 Delete crash files older than a given date
    --before-date <date> ISO date — files with crash dates before this are deleted (required)
    --dry-run           Preview what would be deleted without deleting
  verify-dsym           Validate a .dSYM bundle and check UUID matches against crash files in MainCrashLogsFolder
                        (the post-export location where XCode crash logs and other crashes live).
                        With no flags: dSYM is resolved from the dSYM_File symlink in CRASH_ANALYSIS_PARENT,
                        and crashes are collected from all MainCrashLogsFolder subfolders automatically.
                        --dsym and --crash/--crash-dir must be provided together, or neither.
                        --crash-dir must be within MainCrashLogsFolder.
    --dsym <path>       Path to .dSYM bundle (overrides DSYM_PATH env var and dSYM_File symlink)
    --crash <path>      Path to a single .crash or .ips file (must be within MainCrashLogsFolder) to compare UUIDs against
    --crash-dir <dir>   Directory of crash files within MainCrashLogsFolder to compare UUIDs against
  fix-status            Manage crash fix statuses (unified command)
    --action <set|unset|list>  Action to perform (required)
    --signature <sig>   Crash signature (required for set/unset)
    --note <text>       Optional note (for set action)

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
      case "list-versions":
        cmdListVersions(flags);
        break;
      case "pipeline":
        await cmdPipeline(flags);
        break;
      case "clean":
        cmdClean(flags);
        break;
      case "verify-dsym":
        await cmdVerifyDsym(flags);
        break;
      case "fix-status":
        cmdFixStatus(flags);
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
