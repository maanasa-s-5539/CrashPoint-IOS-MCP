# CrashPoint iOS MCP

A **TypeScript MCP (Model Context Protocol) server** that wraps the CrashPoint iOS crash analysis pipeline as MCP tools. Use it with Claude Desktop, Cursor, and other MCP clients to export, symbolicate, analyze, and report iOS/macOS crash logs — all through natural language.

Also includes a standalone **CLI** (`crashpoint-ios-cli`) for scheduled runs without an AI client.

---

## What It Does

CrashPoint iOS MCP gives your AI assistant the ability to:

1. **Export** `.crash` files from Xcode Organizer `.xccrashpoint` bundles
2. **Symbolicate** crashes using Xcode's `symbolicatecrash` tool and your `.dSYM` bundle
3. **Analyze & group** symbolicated crashes by unique signature, device, iOS version, and app version
4. **Track fixes** locally so your team can mark crash types as resolved

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
  "CRASH_DATE_OFFSET": "3",

  "APP_DISPLAY_NAME": "MyApp",
  "APPTICS_MCP_NAME": "apptics-mcp",
  "PROJECTS_MCP_NAME": "zoho-projects-mcp",

  "ZOHO_CLIQ_WEBHOOK_URL": "https://cliq.zoho.in/...",
  "ZOHO_PROJECTS_MCP_URL": "http://localhost:3000",
  "ZOHO_PROJECTS_PORTAL_ID": "12345",
  "ZOHO_PROJECTS_PROJECT_ID": "67890",
  "ZOHO_BUG_STATUS_OPEN": "status-id",
  "ZOHO_BUG_APP_VERSION": "field-name",
  "ZOHO_BUG_NUM_OF_OCCURRENCES": "field-name"
}
```

### Config key reference

| Key | Required | Description |
|---|---|---|
| `CRASH_ANALYSIS_PARENT` | **Yes** | Path to your ParentHolderFolder |
| `CLAUDE_CLI_PATH` | **Yes** (automation) | Absolute path to the Claude CLI binary (e.g. `~/.local/bin/claude`) |
| `DSYM_PATH` | Recommended | Path to `MyApp.dSYM` bundle — required for symbolication |
| `APP_PATH` | Recommended | Path to `MyApp.app` bundle |
| `APP_NAME` | Optional | App binary name (e.g. `MyApp`) — used to filter frames in reports |
| `MASTER_BRANCH_PATH` | Optional | Path to master/live branch checkout (creates `CurrentMasterLiveBranch` symlink) |
| `DEV_BRANCH_PATH` | Optional | Path to dev branch checkout (creates `CurrentDevelopmentBranch` symlink) |
| `CRASH_INPUT_DIR` | Optional | Override directory searched for `.xccrashpoint` files |
| `CRASH_VERSIONS` | Optional | Comma-separated version filter for exports |
| `CRASH_DATE_OFFSET` | Optional | Days ago to target for daily run (default: `"3"`) |
| `APP_DISPLAY_NAME` | Optional | App name shown in pipeline prompts and Cliq notifications |
| `APPTICS_MCP_NAME` | Optional | Name of your Apptics MCP server (`claude mcp list`) |
| `PROJECTS_MCP_NAME` | Optional | Name of your Zoho Projects MCP server (`claude mcp list`) |
| `ZOHO_CLIQ_WEBHOOK_URL` | Optional | Webhook URL for Zoho Cliq crash notifications |
| `ZOHO_PROJECTS_MCP_URL` | Optional | Base URL of your Zoho Projects MCP server |
| `ZOHO_PROJECTS_PORTAL_ID` | Optional | Zoho Projects portal ID |
| `ZOHO_PROJECTS_PROJECT_ID` | Optional | Zoho Projects project ID |
| `ZOHO_BUG_STATUS_OPEN` | Optional | Status ID for "Open" bugs in Zoho Projects |
| `ZOHO_BUG_APP_VERSION` | Optional | Custom field name for app version on bug items |
| `ZOHO_BUG_NUM_OF_OCCURRENCES` | Optional | Custom field name for occurrence count on bug items |

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

Environment variables override corresponding keys in `crashpoint.config.json` (env always wins). You can still pass them via MCP client `env` blocks for per-client overrides.

| Variable | Required | Description |
|---|---|---|
| `CRASH_ANALYSIS_PARENT` | **Yes** | Path to your ParentHolderFolder |
| `DSYM_PATH` | Recommended | Path to `MyApp.dSYM` bundle — required for symbolication |
| `APP_PATH` | Recommended | Path to `MyApp.app` bundle |
| `APP_NAME` | Optional | App binary name (e.g. `MyApp`) — used to filter frames in reports |
| `CRASH_INPUT_DIR` | Optional | Override directory searched for `.xccrashpoint` files |
| `CRASH_VERSIONS` | Optional | Comma-separated version filter for exports |
| `MASTER_BRANCH_PATH` | Optional | Path to master/live branch checkout (creates `CurrentMasterLiveBranch` symlink) |
| `DEV_BRANCH_PATH` | Optional | Path to dev branch checkout (creates `CurrentDevelopmentBranch` symlink) |

---

## Folder Structure

CrashPoint iOS MCP uses a `ParentHolderFolder` to organize crash data:

```
ParentHolderFolder/                   ← CRASH_ANALYSIS_PARENT
├── crashpoint.config.json            ← Single source of truth for all configuration
├── .mcp.json                         ← Auto-generated by setup_folders (do not edit manually)
├── MainCrashLogsFolder/
│   ├── XCodeCrashLogs/               ← Exported raw .crash files from Xcode Organizer
│   ├── AppticsCrashLogs/             ← User-placed Apptics SDK crash logs
│   └── OtherCrashLogs/              ← User-placed other crash logs
├── SymbolicatedCrashLogsFolder/      ← Symbolicated .crash files
├── AnalyzedReportsFolder/            ← Auto-generated JSON + CSV analysis reports
├── StateMaintenance/                 ← Internal state (processed manifest, fix tracking)
├── Automation/
│   ├── run_crash_pipeline.sh         ← Auto-generated shell script for scheduled runs
│   ├── daily_crash_pipeline_prompt.md ← Prompt template for Claude CLI
│   └── ScheduledRunLogs/             ← Per-run log files
├── CurrentMasterLiveBranch -> ...    ← Symlink to master branch (optional)
├── CurrentDevelopmentBranch -> ...   ← Symlink to dev branch (optional)
├── dSYM_File -> ...                  ← Symlink to .dSYM bundle (optional)
└── app_File -> ...                   ← Symlink to .app bundle (optional)
```

Run `setup_folders` (MCP tool) or `node dist/cli.js setup` to create this structure. `setup_folders` also auto-generates `.mcp.json` in your ParentHolderFolder and the launchd plist at `~/Library/LaunchAgents/com.crashpipeline.daily_mcp.plist` — both only if they don't already exist, so your customizations are never overwritten.

The `StateMaintenance/` folder holds `processed_manifest.json` (tracks which crash files have already been processed, keyed by `Incident Identifier` UUID) and `fix_status.json` (local fix tracking database). This prevents re-exporting and re-symbolicating the same crashes across sessions. Pass `includeProcessedCrashes: true` (MCP) or `--include-processed` (CLI) to override and reprocess all files.

---

## Available MCP Tools

| # | Tool | Description |
|---|---|---|
| 1 | `setup_folders` | Create folder structure + symlinks (uses shared `setupWorkspace` core function) |
| 2 | `list_versions` | List all app versions found in `.xccrashpoint` files |
| 3 | `export_crashes` | Export `.crash` files from `.xccrashpoint` packages to `MainCrashLogsFolder/XCodeCrashLogs`. Add `dryRun: true` to preview without writing |
| 4 | `symbolicate_batch` | Symbolicate crash files. Pass optional `file` param for a single file, or batch-process all of `MainCrashLogsFolder` (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs) |
| 5 | `verify_dsym` | Validate a `.dSYM` bundle and check if its UUIDs match those in crash files from `MainCrashLogsFolder` (the post-export location where XCode crash logs and other crashes live) |
| 6 | `analyze_crashes` | Group & deduplicate crashes by signature; includes fix status. Always auto-generates JSON + CSV reports in `AnalyzedReportsFolder` |
| 7 | `fix_status` | Unified fix tracking: `action='set'` to mark fixed/unfixed, `action='unset'` to clear, `action='list'` to view all |
| 8 | `run_basic_pipeline` | Run the basic pipeline: export → symbolicate → analyze |
| 9 | `clean_old_crashes` | Delete `.crash`/`.ips` files older than a given date across all crash directories |

For detailed parameter documentation, see [Tool Parameters](docs/TOOL_PARAMETERS.md).

---

## Standalone CLI

The CLI lets you run the crash analysis pipeline without an MCP client (useful for scheduled runs):

```bash
# Delete crash files older than a given date (dry-run first)
node dist/cli.js clean --before-date 2026-03-01 --dry-run
node dist/cli.js clean --before-date 2026-03-01

# Create folder structure with symlinks
node dist/cli.js setup --master-branch /path/to/master --dev-branch /path/to/dev --dsym /path/to/MyApp.dSYM --app /path/to/MyApp.app

# List versions in .xccrashpoint files
node dist/cli.js list-versions

# Validate a dSYM bundle and check UUID matches against crashes in MainCrashLogsFolder
node dist/cli.js verify-dsym
node dist/cli.js verify-dsym --crash-dir /path/to/MainCrashLogsFolder/XCodeCrashLogs/ --dsym /path/to/MyApp.dSYM

# Export crash logs from Xcode Organizer
node dist/cli.js export

# Dry-run export: preview what would be exported without writing files
node dist/cli.js export --dry-run

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
```

---

## Symbolication Notes

Symbolication uses Xcode's `symbolicatecrash` tool, which automatically processes all threads and all binaries.

---

## Crash Source Tracking

Each crash file is automatically tagged with its source based on its file path and type. These source breakdowns appear per crash group in the analysis report (e.g. `"sources": { "xcode-organizer": 3, "apptics": 1 }`).

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
