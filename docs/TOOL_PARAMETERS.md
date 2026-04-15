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

### `cleanup_reports` Parameters

| Parameter | Description |
|---|---|
| `beforeDate` | ISO date string — analyzed report files with a report date before this date will be deleted (e.g. `2026-03-01`). Report date is extracted from the filename timestamp for `jsonReport_<timestamp>.json` and `sheetReport_<timestamp>.csv`; falls back to file modification time. Stable pointer files (`latest.json`, `latest.csv`) are never deleted. |
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
| `force` | When `true`, overwrite existing automation files (`run_crash_pipeline.sh`, phase prompts) with the latest version. Default `false` (skip existing files) |

### `run_basic_pipeline` Parameters

Automatically runs `setup_folders` on the first invocation if the workspace hasn't been initialized yet (checks for `StateMaintenance/` and `Automation/` directories).

| Parameter | Description |
|---|---|
| `versions` | Comma-separated version filter for crash export (optional) |
| `numDays` | Number of days to process (1–180). End date = today minus `CRASH_DATE_OFFSET`, start date = end date minus numDays + 1. Overrides `CRASH_NUM_DAYS` in config. Default: 1 (optional) |
| `includeProcessedCrashes` | When `true`, re-processes crashes that were already exported/symbolicated/analyzed. Default `false` (optional) |

### `run_full_pipeline` Parameters

Automatically runs `setup_folders` on the first invocation if the workspace hasn't been initialized yet (checks for `StateMaintenance/` and `Automation/` directories).

| Parameter | Description |
|---|---|
| `notifyCliq` | When `true`, send a notification to Zoho Cliq after analysis. Default `false` (optional) |
| `reportToProjects` | When `true`, create/update Zoho Projects bugs after analysis. Default `false` (optional) |
| `unfixedOnly` | When `true`, only include unfixed crash groups in notifications/reports (optional) |
| `versions` | Comma-separated version filter for crash export (optional) |
| `numDays` | Number of days to process (1–180). End date = today minus `CRASH_DATE_OFFSET`, start date = end date minus numDays + 1. Overrides `CRASH_NUM_DAYS` in config (optional) |
| `dryRun` | When `true`, no side effects — dry-run for all stages (optional) |
| `skipDownload` | When `true`, skip the Apptics crash download check and only run export/symbolicate/analyze on existing files. Default `false` (optional) |
| `expectedCrashCount` | Expected number of Apptics crash files. If provided, the pipeline will warn if the actual count doesn't match (optional) |

### `save_apptics_crashes` Parameters

| Parameter | Description |
|---|---|
| `crashes` | Array of crash entries fetched from the Apptics Zoho MCP (required). See crash entry fields below. |
| `clearExisting` | When `true` (default), remove all existing `.crash` files from `AppticsCrashLogs/` before saving new ones (optional) |

**Crash entry fields** (all optional except `UniqueMessageID`):

| Field | Description |
|---|---|
| `UniqueMessageID` | Unique crash identifier from Apptics (required) |
| `Exception` | Exception type string |
| `CrashCount` | Number of crash occurrences |
| `DevicesCount` | Number of affected devices |
| `UsersCount` | Number of affected users |
| `AppVersion` | App version string |
| `OS` | Operating system name |
| `Message` | Full crash report text with stack trace (used as primary crash file content when present) |
| `IssueName` | Apptics issue name |
| `Model` | Device model |
| `OSVersion` | OS version string |
| `date` | Date/time of the crash |
| `CrashDesc` | Crash description |
| `AppReleaseVersion` | App release/build version |
| `DeviceID` | Device identifier |
| `NetworkStatus` | Network status at crash time |
| `BatteryStatus` | Battery status at crash time |
| `Edge` | Edge/connectivity info |
| `Orientation` | Device orientation |

### `notify_cliq` Parameters

| Parameter | Description |
|---|---|
| `reportPath` | Path to the report JSON file. Defaults to `latest.json` in `AnalyzedReportsFolder` (optional) |
| `unfixedOnly` | When `true`, only include crash groups that are NOT marked as fixed (optional) |
| `dryRun` | When `true`, show the message that would be sent without actually posting to Cliq (optional) |

### `prepare_project_bugs` Parameters

| Parameter | Description |
|---|---|
| `reportPath` | Path to the report JSON file. Defaults to `latest.json` in `AnalyzedReportsFolder` (optional) |
| `unfixedOnly` | When `true`, only include crash groups NOT marked as fixed (optional) |
| `dryRun` | When `true`, show what would be prepared without reading the full report — returns a summary only (optional) |

### `cleanup_all` Parameters

| Parameter | Description |
|---|---|
| `dryRun` | When `true`, list what would be deleted without actually deleting (optional) |
| `keepReports` | When `true`, preserve report files in `AnalyzedReportsFolder` (only clean crash files) (optional) |
| `keepManifests` | When `true`, preserve processed manifests in `StateMaintenance` (optional) |
