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

### MCP Client Configuration

All MCP clients use the same JSON block — only the config file path differs.

**Block to add:**

```json
{
  "mcpServers": {
    "crashpoint-ios": {
      "command": "npx",
      "args": [
        "-p",
        "github:maanasa-s-5539/CrashPoint-IOS-MCP",
        "crashpoint-ios-core"
      ],
      "env": {
        "CRASH_INPUT_DIR": "/path/to/Xcode/Products/com.example.myapp/Crashes/Points",
        "CRASH_ANALYSIS_PARENT": "/path/to/ParentHolderFolder"
      }
    }
  }
}
```

**Where to put it:**

| Client | Config file | Where in the file |
|---|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` | Top-level `mcpServers` object |
| Claude CLI (Claude Code) | `~/.claude.json` | Top-level `mcpServers` object (not inside `projects`) so it is visible from any folder |
| Cursor | `.cursor/mcp.json` in your project root | Top-level `mcpServers` object |

If the chosen file already contains an `mcpServers` object, add the `"crashpoint-ios": { ... }` entry inside the existing object instead of duplicating the key.

Replace `/path/to/...` with real absolute paths on your machine. `CRASH_ANALYSIS_PARENT` is required; `CRASH_INPUT_DIR` is optional and only needed when overriding the default Xcode crash input location.

All other values (paths, app name, etc.) are read automatically from `crashpoint.config.json`.

Restart Claude Desktop, Cursor, or start a new `claude` CLI session after saving the file.

---

## Environment Variables

Only `CRASH_ANALYSIS_PARENT` is required as an environment variable — it tells the server where to find `crashpoint.config.json`. All other settings live in that config file.

Environment variables can still override any key from `crashpoint.config.json` (env always wins) if you need per-client overrides via MCP client `env` blocks.

---

## Quick Start

There are **two ways** to run the CrashPoint pipeline. Choose the path that fits your workflow:

---

### Path A: Claude Desktop / Cursor (zero manual setup)

The MCP tools automatically create the entire workspace on the **very first run** — no `setup` command needed beforehand.

1. **Clone & build the repo** (or install via npx — see [Installation](#installation) above).
2. **Create your ParentHolderFolder** and place a filled-in `crashpoint.config.json` inside it (see [Configuration](#configuration) above).
3. **Configure your MCP client** with `CRASH_ANALYSIS_PARENT` pointing to your ParentHolderFolder (see the Cursor / Claude Desktop block in [Configuration](#configuration) above).
4. **Ask Claude to call `run_full_pipeline`** — on the very first call, the MCP server detects that the workspace doesn't exist yet and automatically runs setup (creating all folders, copying prompt templates, generating `run_crash_pipeline.sh` with your real paths, and writing `.mcp.json`). No prior setup step is needed.

> **That's it.** After the first `run_full_pipeline` (or `run_basic_pipeline`) call, the full workspace is ready and every subsequent call works without any additional configuration.

---

### Path B: Terminal bash script (one-time setup required first)

The bash script at `ParentHolderFolder/Automation/run_crash_pipeline.sh` **does not exist** until a setup command generates it. The repo contains only a template (`automation/run_crash_pipeline.sh`) with `<REPLACE_WITH_...>` placeholders. The setup command replaces those placeholders with your real paths automatically — you never need to edit them manually.

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

# 3. Run the setup command once — creates the folder structure AND generates
#    run_crash_pipeline.sh with your real paths automatically filled in
CRASH_ANALYSIS_PARENT=/path/to/ParentHolderFolder node dist/cli.js setup

# 4. Run the generated script (placeholders already replaced — no manual editing needed)
bash /path/to/ParentHolderFolder/Automation/run_crash_pipeline.sh
```

> **Note:** The auto-setup block inside the generated bash script (which calls `node dist/cli.js setup` if folders are missing) is a **safety net for subsequent runs** — for example if folders were accidentally deleted. It is not the mechanism for the initial bootstrap. Step 3 above is the required first-time step.

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

**Using Claude Desktop / Cursor (MCP path):** The folder structure is created automatically on the first call to `run_full_pipeline` or `run_basic_pipeline` — no manual setup step needed. The MCP server also generates `Automation/run_crash_pipeline.sh` with your real paths filled in as part of this auto-setup.

**Using the terminal bash script:** Run `CRASH_ANALYSIS_PARENT=/path/to/ParentHolderFolder node dist/cli.js setup` once to create the folder structure and generate `Automation/run_crash_pipeline.sh` with your real paths. After that, run `bash /path/to/ParentHolderFolder/Automation/run_crash_pipeline.sh`. You can also run `setup_folders` in Claude Desktop / Cursor to do the same thing interactively.

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
