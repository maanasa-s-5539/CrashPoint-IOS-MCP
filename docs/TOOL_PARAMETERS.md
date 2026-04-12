# MCP Tool Parameters

### `export_crashes` Parameters

| Parameter | Description |
|---|---|
| `inputDir` | Directory to search for `.xccrashpoint` files (default: `CRASH_INPUT_DIR` or `CRASH_ANALYSIS_PARENT`) |
| `outputDir` | Destination directory (default: `MainCrashLogsFolder/XCodeCrashLogs`) |
| `versions` | Comma-separated version filter |
| `recursive` | Search subdirectories recursively |
| `numDays` | Number of days to process (1–180). End date = today minus `CRASH_DATE_OFFSET` (default 4), start date = end date minus numDays + 1. Overrides `CRASH_NUM_DAYS` in config. Default: 1. |
| `dryRun` | When `true`, shows what would be exported without writing any files |

### `symbolicate_batch` Parameters

| Parameter | Description |
|---|---|
| `file` | Path to a single `.crash` or `.ips` file to symbolicate (optional — omit for full batch mode) |
| `dsymPath` | Override dSYM path (default: `DSYM_PATH` env var) |
| `outputDir` | Override output directory (default: `SymbolicatedCrashLogsFolder`) |
| `includeProcessedCrashes` | When `true`, re-symbolicate already-processed files |

### `analyze_crashes` Parameters

| Parameter | Description |
|---|---|
| `includeProcessedCrashes` | When `true`, re-analyze already-processed files |

> **Note:** Reports are always auto-generated in `AnalyzedReportsFolder`. A JSON report (`jsonReport_<timestamp>.json`) and a CSV report (`sheetReport_<timestamp>.csv`) are created on every run. The source directory is always `SymbolicatedCrashLogsFolder`.

### `fix_status` Parameters

| Parameter | Description |
|---|---|
| `action` | `"set"`, `"unset"`, or `"list"` |
| `signature` | Crash signature string (required for `set` and `unset`) |
| `fixed` | `true` to mark as fixed, `false` for unfixed (used with `set`, defaults to `true`) |
| `note` | Optional note (e.g. PR reference) |

### `clean_old_crashes` Parameters

| Parameter | Description |
|---|---|
| `beforeDate` | ISO date string — files with crash dates before this date will be deleted (e.g. `2026-03-01`) |
| `dryRun` | When `true`, reports what would be deleted without actually deleting (default: `false`) |

### `verify_dsym` Parameters

| Parameter | Description |
|---|---|
| `dsymPath` | Path to `.dSYM` bundle (defaults to `DSYM_PATH` env var). Must be provided together with `crashPath`/`crashDir`, or omitted entirely. |
| `crashPath` | Path to a single `.crash` or `.ips` file to compare UUIDs against. Must be within `MainCrashLogsFolder`. Must be provided together with `dsymPath`, or omitted entirely. |
| `crashDir` | Directory of crash files to compare UUIDs against. Must be within `MainCrashLogsFolder`. Must be provided together with `dsymPath`, or omitted entirely. |

### `setup_folders` Parameters

| Parameter | Description |
|---|---|
| `masterBranchPath` | Path to master branch checkout → creates `CurrentMasterLiveBranch` symlink |
| `devBranchPath` | Path to dev branch checkout → creates `CurrentDevelopmentBranch` symlink |
| `dsymPath` | Path to .dSYM bundle → creates `dSYM_File` symlink |
| `appPath` | Path to .app bundle → creates `app_File` symlink |
