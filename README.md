# CrashPoint iOS MCP

A **TypeScript MCP (Model Context Protocol) server** that wraps the CrashPoint iOS crash analysis pipeline as MCP tools. Use it with Claude Desktop, Cursor, and other MCP clients to export, symbolicate, analyze, and report iOS/macOS crash logs — all through natural language.

Also includes a standalone **CLI** (`crashpoint-ios-cli`) for scheduled runs without an AI client.

---

## What It Does

CrashPoint iOS MCP gives your AI assistant the ability to:

1. **Export** `.crash` files from Xcode Organizer `.xccrashpoint` bundles
2. **Save** Apptics crash data as `.crash` files for unified processing
3. **Symbolicate** crashes using Xcode's `symbolicatecrash` tool and your `.dSYM` bundle
4. **Analyze & group** symbolicated crashes by unique signature, device, iOS version, and app version
5. **Track fixes** locally so your team can mark crash types as resolved
6. **Notify Zoho Cliq** with crash report summaries via webhook
7. **Report to Zoho Projects** — prepare structured bug data for creation/updates
8. **Run the full pipeline** end-to-end with Apptics, Cliq, and Zoho Projects integration

---

## Prerequisites

- **macOS** (required for Xcode's `symbolicatecrash` and `dwarfdump`)
- **Node.js 18+**
- **Xcode CLI tools** (`xcode-select --install`)
- A `.dSYM` bundle for your app
- A `.app` bundle for your app (optional)
- Xcode Organizer crash data (`.xccrashpoint` files)

---

## Installation

```bash
git clone https://github.com/maanasa-s-5539/CrashPoint-IOS-MCP.git
cd CrashPoint-IOS-MCP
npm install
npm run build
```

---

## Configuration

Copy `crashpoint.config.example.json` from the repo root to `<ParentHolderFolder>/crashpoint.config.json` and fill in your values:

```bash
cp crashpoint.config.example.json /path/to/ParentHolderFolder/crashpoint.config.json
```

This JSON config file is the **single source of truth** for all user configuration — you only need to edit this one file. The `.mcp.json` (used by Claude CLI for the automation pipeline) and the launchd `.plist` (for scheduled daily runs) are **auto-generated** from it by `setup_folders` and by `run_crash_pipeline.sh` on first run.

When both the JSON config file and environment variables provide the same key, **environment variables win** — values in `process.env` override values from the JSON config file. This means MCP client `env` blocks (or a `.env` file used as a fallback) can always override the JSON config.

### Complete `crashpoint.config.json` example

```json
{
  "CRASH_ANALYSIS_PARENT": "/path/to/ParentHolderFolder",
  "CLAUDE_CLI_PATH": "/Users/name/.local/bin/claude",

  "DSYM_PATH": "/path/to/MyApp.app.dSYM",
  "APP_PATH": "/path/to/MyApp.app",
  "APP_NAME": "MyApp",
  "MASTER_BRANCH_PATH": "/path/to/master",
  "DEV_BRANCH_PATH": "/path/to/dev",

  "CRASH_INPUT_DIR": "",
  "CRASH_VERSIONS": "1.0.0",
  "CRASH_DATE_OFFSET": "4",
  "CRASH_NUM_DAYS": "1",
  "SCHEDULED_RUN_TIME": "11:00",

  "APP_DISPLAY_NAME": "MyApp",
  "APPTICS_MCP_NAME": "apptics-mcp",
  "APPTICS_PORTAL_ID": "12345",
  "APPTICS_PROJECT_ID": "67890",
  "APPTICS_APP_NAME": "MyApp",

  "ZOHO_CLIQ_WEBHOOK_URL": "https://cliq.zoho.in/...",
  "ZOHO_PROJECTS_PORTAL_ID": "12345",
  "ZOHO_PROJECTS_PROJECT_ID": "67890",
  "ZOHO_BUG_STATUS_OPEN": "status-id-open",
  "ZOHO_BUG_STATUS_FIXED": "status-id-fixed",
  "ZOHO_BUG_SEVERITY_SHOWSTOPPER": "severity-id-showstopper",
  "ZOHO_BUG_SEVERITY_CRITICAL": "severity-id-critical",
  "ZOHO_BUG_SEVERITY_MAJOR": "severity-id-major",
  "ZOHO_BUG_SEVERITY_MINOR": "severity-id-minor",
  "ZOHO_BUG_SEVERITY_NONE": "severity-id-none",
  "ZOHO_BUG_APP_VERSION": "field-name",
  "ZOHO_BUG_NUM_OF_OCCURRENCES": "field-name"
}
```

### Config key reference

| Key | Description |
|---|---|
| `CRASH_ANALYSIS_PARENT` | Path to your ParentHolderFolder |
| `CLAUDE_CLI_PATH` | Absolute path to the Claude CLI binary (e.g. `~/.local/bin/claude`) |
| `DSYM_PATH` | Path to `MyApp.dSYM` bundle — needed for symbolication |
| `APP_PATH` | Path to `MyApp.app` bundle |
| `APP_NAME` | App binary name (e.g. `MyApp`) — used to filter frames in reports |
| `MASTER_BRANCH_PATH` | Path to master/live branch checkout (creates `CurrentMasterLiveBranch` symlink) |
| `DEV_BRANCH_PATH` | Path to dev branch checkout (creates `CurrentDevelopmentBranch` symlink) |
| `CRASH_INPUT_DIR` | Override directory searched for `.xccrashpoint` files |
| `CRASH_VERSIONS` | Comma-separated version filter for exports |
| `CRASH_DATE_OFFSET` | Days ago to target for daily run (default: `"3"`) |
| `CRASH_NUM_DAYS` | Number of days to process in the crash window (1–180, default: `"1"`) |
| `SCHEDULED_RUN_TIME` | Time of day for the scheduled launchd pipeline run in HH:MM 24-hour format, where HH is 0–23 and MM is 0–59 (default: `"11:00"`) |
| `APP_DISPLAY_NAME` | App name shown in pipeline prompts and Cliq notifications |
| `APPTICS_MCP_NAME` | Name of your Apptics MCP server (`claude mcp list`) — also provides Zoho Projects tools (`list_bugs`, `create_bug`, `update_bug`) |
| `ZOHO_CLIQ_WEBHOOK_URL` | Webhook URL for Zoho Cliq crash notifications |
| `ZOHO_PROJECTS_PORTAL_ID` | Zoho Projects portal ID |
| `ZOHO_PROJECTS_PROJECT_ID` | Zoho Projects project ID |
| `APPTICS_PORTAL_ID` | Apptics portal ID (`zsoid`) |
| `APPTICS_PROJECT_ID` | Apptics project ID |
| `APPTICS_APP_NAME` | App name as it appears in Apptics |
| `ZOHO_BUG_STATUS_OPEN` | Status ID for "Open" bugs in Zoho Projects |
| `ZOHO_BUG_STATUS_FIXED` | Status ID for "Fixed" bugs in Zoho Projects |
| `ZOHO_BUG_SEVERITY_SHOWSTOPPER` | Severity ID for Showstopper (≥50 occurrences) |
| `ZOHO_BUG_SEVERITY_CRITICAL` | Severity ID for Critical (≥20 occurrences) |
| `ZOHO_BUG_SEVERITY_MAJOR` | Severity ID for Major (≥5 occurrences) |
| `ZOHO_BUG_SEVERITY_MINOR` | Severity ID for Minor (≥2 occurrences) |
| `ZOHO_BUG_SEVERITY_NONE` | Severity ID for None (<2 occurrences) |
| `ZOHO_BUG_APP_VERSION` | Custom field name for app version on bug items |
| `ZOHO_BUG_NUM_OF_OCCURRENCES` | Custom field name for occurrence count on bug items |

### Cursor / Claude Desktop

Add the following configuration to your MCP client:

```json
{
  "mcpServers": {
    "crashpoint-ios": {
      "command": "npx",
      "args": ["-p", "github:maanasa-s-5539/CrashPoint-IOS-MCP", "crashpoint-ios-core"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "/path/to/ParentHolderFolder"
      }
    }
  }
}
```

All other values (paths, app name, etc.) are read automatically from `crashpoint.config.json`.

**Config file paths:**
- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Cursor:** `.cursor/mcp.json` in your project root

---

## Environment Variables

Only `CRASH_ANALYSIS_PARENT` is required as an environment variable — it tells the server where to find `crashpoint.config.json`. All other settings live in that config file.

Environment variables can still override any key from `crashpoint.config.json` (env always wins) if you need per-client overrides via MCP client `env` blocks.

---

## Quick Start: First Pipeline Run from Terminal

If you want to run the bash pipeline (`run_crash_pipeline.sh`) from the terminal for the first time, follow these four steps:

```bash
# 1. Clone and build the repo
git clone https://github.com/maanasa-s-5539/CrashPoint-IOS-MCP.git
cd CrashPoint-IOS-MCP
npm install
npm run build

# 2. Create your ParentHolderFolder and fill in crashpoint.config.json
mkdir -p /path/to/ParentHolderFolder
cp crashpoint.config.example.json /path/to/ParentHolderFolder/crashpoint.config.json
# Edit /path/to/ParentHolderFolder/crashpoint.config.json with your real values

# 3. Run the setup command — this creates the folder structure AND generates
#    run_crash_pipeline.sh with your real paths automatically filled in
CRASH_ANALYSIS_PARENT=/path/to/ParentHolderFolder node dist/cli.js setup

# 4. Now run the generated script (placeholders are already replaced — no manual editing needed)
bash /path/to/ParentHolderFolder/Automation/run_crash_pipeline.sh
```

> **Important:** The bash script at `ParentHolderFolder/Automation/run_crash_pipeline.sh` does **not exist** until `node dist/cli.js setup` runs. The setup command reads the template from the repo's `automation/` directory, replaces the `<REPLACE_WITH_PATH_TO_PARENT_HOLDER_FOLDER>` and `<REPLACE_WITH_CRASHPOINT_PACKAGE_ROOT>` placeholders with your real paths, and writes the result to `ParentHolderFolder/Automation/run_crash_pipeline.sh`. You never need to manually edit any placeholders.

---

## Folder Structure

CrashPoint iOS MCP uses a `ParentHolderFolder` to organize crash data:

```
ParentHolderFolder/                   ← CRASH_ANALYSIS_PARENT
├── crashpoint.config.json            ← Single source of truth for all configuration
├── .mcp.json                         ← Auto-generated (do not edit manually)
├── MainCrashLogsFolder/
│   ├── XCodeCrashLogs/               ← Exported .crash files from Xcode Organizer
│   ├── AppticsCrashLogs/             ← Apptics SDK crash logs
│   └── OtherCrashLogs/              ← Other crash logs
├── SymbolicatedCrashLogsFolder/      ← Symbolicated .crash files
├── AnalyzedReportsFolder/            ← JSON + CSV analysis reports
├── StateMaintenance/                 ← Processed manifest + fix tracking
└── Automation/                       ← Pipeline scripts, prompts, and logs
    ├── run_crash_pipeline.sh         ← Generated by setup (placeholders auto-replaced)
    ├── daily_crash_pipeline_prompt_phase1.md
    ├── daily_crash_pipeline_prompt_phase2.md
    └── ScheduledRunLogs/
```

Run `setup_folders` (MCP tool) or `node dist/cli.js setup` to create this structure and generate `Automation/run_crash_pipeline.sh` with your real paths. `run_full_pipeline` and `run_basic_pipeline` will also auto-create the folder structure on first run (but they do not generate the bash script — use `setup` or `setup_folders` for that).

---

## Available MCP Tools

| # | Tool | Description |
|---|---|---|
| 1 | `setup_folders` | Create the complete folder structure, generate `.mcp.json` + launchd plist, scaffold automation scripts (phase1 + phase2 prompts + shell script), and create symlinks — all in one command. Recommended for full control (symlinks, launchd plist, etc.). Note: `run_basic_pipeline` and `run_full_pipeline` will auto-run setup on first invocation if the workspace hasn't been initialized yet |
| 2 | `export_crashes` | Export `.crash` files from `.xccrashpoint` packages to `MainCrashLogsFolder/XCodeCrashLogs`. Add `dryRun: true` to preview without writing |
| 3 | `save_apptics_crashes` | Save crash data fetched from the Apptics Zoho MCP as `.crash` files in `AppticsCrashLogs/`. Uses `UniqueMessageID` in filenames for idempotency |
| 4 | `symbolicate_batch` | Symbolicate crash files. Pass optional `file` param for a single file, or batch-process all of `MainCrashLogsFolder` (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs) |
| 5 | `verify_dsym` | Validate a `.dSYM` bundle and check if its UUIDs match those in crash files from `MainCrashLogsFolder` |
| 6 | `analyze_crashes` | Group & deduplicate crashes by signature; includes fix status. Always auto-generates JSON + CSV reports in `AnalyzedReportsFolder` |
| 7 | `fix_status` | Unified fix tracking: `action='set'` to mark fixed/unfixed, `action='unset'` to clear, `action='list'` to view all |
| 8 | `run_basic_pipeline` | Run the basic pipeline: export → symbolicate → analyze. Automatically initializes the workspace on first run if `setup_folders` hasn't been run yet |
| 9 | `run_full_pipeline` | Run the full pipeline with Zoho integration: export → symbolicate → analyze. Returns `nextSteps` flags (`notifyCliq`, `reportToProjects`) for follow-up actions. Automatically initializes the workspace on first run if `setup_folders` hasn't been run yet |
| 10 | `notify_cliq` | Send crash report summary to a Zoho Cliq channel via incoming webhook |
| 11 | `prepare_project_bugs` | Prepare structured bug data from crash reports for Zoho Projects submission (titles, descriptions, severity, custom fields) |
| 12 | `clean_old_crashes` | Delete `.crash`/`.ips` files older than a given date across all crash directories |
| 13 | `cleanup_reports` | Delete analyzed report files (`.json`/`.csv`) in `AnalyzedReportsFolder` that are older than a given date |
| 14 | `cleanup_all` | Remove all crash files and reports in one go. Supports `dryRun`, `keepReports`, and `keepManifests` flags |

For detailed parameter documentation, see [Tool Parameters](docs/TOOL_PARAMETERS.md).

---

## Standalone CLI

The CLI lets you run the crash analysis pipeline without an MCP client (useful for scheduled runs):

```bash
# Delete crash files older than a given date
node dist/cli.js clean --before-date 2026-03-01

# Delete analyzed report files in AnalyzedReportsFolder older than a given date
node dist/cli.js cleanup-reports --before-date 2026-03-01

# Create folder structure with symlinks
node dist/cli.js setup --master-branch /path/to/master --dev-branch /path/to/dev --dsym /path/to/MyApp.dSYM --app /path/to/MyApp.app

# Validate a dSYM bundle and check UUID matches against crashes in MainCrashLogsFolder
node dist/cli.js verify-dsym
node dist/cli.js verify-dsym --crash-dir /path/to/MainCrashLogsFolder/XCodeCrashLogs/ --dsym /path/to/MyApp.dSYM

# Export crash logs from Xcode Organizer
node dist/cli.js export

# Export crashes filtered by date range
node dist/cli.js export --start-date 2026-03-01 --end-date 2026-03-20

# Symbolicate all crash files in MainCrashLogsFolder (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs)
node dist/cli.js batch

# Symbolicate a single crash file
node dist/cli.js batch --file /path/to/crash.crash

# Analyze crashes and print JSON report (also auto-saves JSON + CSV to AnalyzedReportsFolder)
node dist/cli.js analyze

# Manage fix statuses (unified command)
node dist/cli.js fix-status --action set --signature "EXC_BAD_ACCESS SIGSEGV" --note "Fixed in PR #42"
node dist/cli.js fix-status --action unset --signature "EXC_BAD_ACCESS SIGSEGV"
node dist/cli.js fix-status --action list

# Run basic pipeline (export → symbolicate → analyze)
node dist/cli.js pipeline

# Remove all crash files and reports in one go
node dist/cli.js cleanup                  # delete everything
node dist/cli.js cleanup --keep-reports   # only delete crash files, preserve reports
node dist/cli.js cleanup --keep-manifests # preserve processed manifests
```

---

## Fix Tracking

Crash fix statuses are stored in `{CRASH_ANALYSIS_PARENT}/StateMaintenance/fix_status.json` (local only, gitignored).

```json
{
  "EXC_BAD_ACCESS||MyApp  -[ViewController load]||...": {
    "fixed": true,
    "note": "Fixed in PR #42",
    "updatedAt": "2026-03-22T16:00:00.000Z"
  }
}
```

---

## License

MIT
