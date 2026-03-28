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

Install directly from GitHub (NOT from npm registry):

```bash
npm install github:maanasa-s-5539/CrashPoint-IOS-MCP
```

This automatically compiles the TypeScript source during installation via the `prepare` script.

---

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

### Cursor / Claude Desktop

Add the following configuration to your MCP client:

```json
{
  "mcpServers": {
    "crashpoint-ios": {
      "command": "npx",
      "args": ["github:maanasa-s-5539/CrashPoint-IOS-MCP"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "/path/to/ParentHolderFolder",
        "DSYM_PATH": "/path/to/MyApp.dSYM",
        "APP_PATH": "/path/to/MyApp.app",
        "APP_NAME": "MyApp",
        "MASTER_BRANCH_PATH": "/path/to/app-ios-master",
        "DEV_BRANCH_PATH": "/path/to/app-ios-dev"
      }
    }
  }
}
```

**Config file paths:**
- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Cursor:** `.cursor/mcp.json` in your project root

---

## Environment Variables

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
├── MainCrashLogsFolder/
│   ├── XCodeCrashLogs/               ← Exported raw .crash files from Xcode Organizer
│   ├── AppticsCrashLogs/             ← User-placed Apptics SDK crash logs
│   └── OtherCrashLogs/              ← User-placed other crash logs
├── SymbolicatedCrashLogsFolder/      ← Symbolicated .crash files
├── AnalyzedReportsFolder/            ← Auto-generated JSON + CSV analysis reports
├── StateMaintenance/                 ← Internal state (processed manifest, fix tracking)
├── CurrentMasterLiveBranch -> ...    ← Symlink to master branch (optional)
├── CurrentDevelopmentBranch -> ...   ← Symlink to dev branch (optional)
├── dSYM_File -> ...                  ← Symlink to .dSYM bundle (optional)
└── app_File -> ...                   ← Symlink to .app bundle (optional)
```

Run `setup_folders` (MCP tool) or `node dist/cli.js setup` to create this structure.

The `StateMaintenance/` folder holds `processed_manifest.json` (tracks which crash files have already been processed, keyed by `Incident Identifier` UUID) and `fix_status.json` (local fix tracking database). This prevents re-exporting and re-symbolicating the same crashes across sessions. Pass `includeProcessedCrashes: true` (MCP) or `--include-processed` (CLI) to override and reprocess all files.

---

## Available MCP Tools

| # | Tool | Description |
|---|---|---|
| 1 | `setup_folders` | Create folder structure + symlinks (uses shared `setupWorkspace` core function) |
| 2 | `list_versions` | List all app versions found in `.xccrashpoint` files |
| 3 | `export_crashes` | Export `.crash` files from `.xccrashpoint` packages to `MainCrashLogsFolder/XCodeCrashLogs`. Add `dryRun: true` to preview without writing |
| 4 | `symbolicate_batch` | Symbolicate crash files. Pass optional `file` param for a single file, or batch-process all of `MainCrashLogsFolder` (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs) |
| 5 | `verify_dsym` | Validate a `.dSYM` bundle and check if its UUIDs match those in crash files |
| 6 | `analyze_crashes` | Group & deduplicate crashes by signature; includes fix status. Always auto-generates JSON + CSV reports in `AnalyzedReportsFolder` |
| 7 | `fix_status` | Unified fix tracking: `action='set'` to mark fixed/unfixed, `action='unset'` to clear, `action='list'` to view all |
| 8 | `run_full_pipeline` | Run the complete pipeline: export → symbolicate → analyze |
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

# Validate a dSYM bundle and check UUID matches
node dist/cli.js verify-dsym
node dist/cli.js verify-dsym --crash-dir /path/to/crashes/ --dsym /path/to/MyApp.dSYM

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

# Run full pipeline (export → symbolicate → analyze)
node dist/cli.js pipeline
```

If installed globally, you can also use:

```bash
crashpoint-ios-cli analyze
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
