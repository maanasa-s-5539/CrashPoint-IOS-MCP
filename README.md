# CrashPoint iOS MCP

A **TypeScript MCP (Model Context Protocol) server** that wraps the CrashPoint iOS crash analysis pipeline as MCP tools. Use it with Claude Desktop, Cursor, and other MCP clients to export, symbolicate, analyze, and report iOS/macOS crash logs — all through natural language.

Also includes a standalone **CLI** (`crashpoint-ios-cli`) for scheduled runs without an AI client.

---

## What It Does

CrashPoint iOS MCP gives your AI assistant the ability to:

1. **Export** `.crash` files from Xcode Organizer `.xccrashpoint` bundles
2. **Symbolicate** crashes using Xcode's `symbolicatecrash` tool and your `.dSYM` bundle
3. **Analyze & group** symbolicated crashes by unique signature, device, iOS version, and app version
4. **Report** crash analysis to your Zoho Cliq channel (including fix status and source labels)
5. **Track fixes** locally so your team can mark crash types as resolved

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
        "DEV_BRANCH_PATH": "/path/to/app-ios-dev",
        "ZOHO_CLIQ_WEBHOOK_URL": "https://cliq.zoho.com/..."
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
| `ZOHO_CLIQ_WEBHOOK_URL` | Optional | Incoming webhook URL for a Zoho Cliq channel — the only Cliq integration method |
| `ZOHO_PROJECTS_MCP_URL` | Optional | Zoho Projects MCP server URL |
| `ZOHO_PROJECTS_PORTAL_ID` | Optional | Zoho Projects portal ID |
| `ZOHO_PROJECTS_PROJECT_ID` | Optional | Zoho Projects project ID |
| `ZOHO_BUG_STATUS_OPEN` | Optional | Zoho bug status field value ID for Open |
| `ZOHO_BUG_STATUS_FIXED` | Optional | Zoho bug status field value ID for Fixed |
| `ZOHO_BUG_SEVERITY_SHOWSTOPPER` | Optional | Zoho bug severity field value ID for ShowStopper |
| `ZOHO_BUG_SEVERITY_CRITICAL` | Optional | Zoho bug severity field value ID for Critical |
| `ZOHO_BUG_SEVERITY_MAJOR` | Optional | Zoho bug severity field value ID for Major |
| `ZOHO_BUG_SEVERITY_MINOR` | Optional | Zoho bug severity field value ID for Minor |
| `ZOHO_BUG_SEVERITY_NONE` | Optional | Zoho bug severity field value ID for None |

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
├── CurrentMasterLiveBranch -> ...    ← Symlink to master branch (optional)
├── CurrentDevelopmentBranch -> ...   ← Symlink to dev branch (optional)
├── dSYM_File -> ...                  ← Symlink to .dSYM bundle (optional)
├── app_File -> ...                   ← Symlink to .app bundle (optional)
└── fix_status.json                   ← Local fix tracking database
```

Run `setup_folders` (MCP tool) or `scripts/setup_symlinks.sh` to create this structure.

### Standalone Symlink Setup

```bash
CRASH_ANALYSIS_PARENT=/path/to/ParentHolderFolder \
MASTER_BRANCH_PATH=/path/to/app-ios-master \
DEV_BRANCH_PATH=/path/to/app-ios-dev \
DSYM_PATH=/path/to/MyApp.dSYM \
APP_PATH=/path/to/MyApp.app \
bash scripts/setup_symlinks.sh
```

---

## Available MCP Tools

| # | Tool | Description |
|---|---|---|
| 1 | `list_versions` | List all app versions found in `.xccrashpoint` files |
| 2 | `export_crashes` | Export `.crash` files from `.xccrashpoint` packages to `MainCrashLogsFolder/XCodeCrashLogs`. Add `dryRun: true` to preview without writing |
| 3 | `symbolicate_one` | Symbolicate a single `.crash` file using Xcode's `symbolicatecrash` tool |
| 4 | `symbolicate_batch` | Batch symbolicate all crashes in `MainCrashLogsFolder` (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs) |
| 5 | `diagnose_frames` | Frame-by-frame diff: shows which frames were resolved vs missed |
| 6 | `analyze_crashes` | Group & deduplicate crashes by signature; includes fix status |
| 7 | `notify_cliq` | Analyze crashes and send report to Zoho Cliq. Supports `unfixedOnly` flag and dry-run |
| 8 | `set_fix_status` | Mark a crash signature as fixed (`fixed: true`) or unfixed (`fixed: false`) |
| 9 | `list_fix_statuses` | Show all locally tracked fix statuses |
| 10 | `run_full_pipeline` | Run the complete pipeline: export → symbolicate → analyze → (optionally notify) |
| 11 | `setup_folders` | Create folder structure + optional branch symlinks + copy existing crash files |
| 12 | `report_to_zoho_projects` | Create/update bugs in Zoho Projects for each unique crash group |
| 13 | `search_crashes` | Search crash files for a keyword or pattern (exception type, frames, file content) |
| 14 | `clean_old_crashes` | Delete `.crash`/`.ips` files older than a given date across all crash directories |
| 15 | `verify_dsym` | Validate a `.dSYM` bundle and check if its UUIDs match those in crash files |

### `export_crashes` Parameters

| Parameter | Description |
|---|---|
| `inputDir` | Directory to search for `.xccrashpoint` files (default: `CRASH_INPUT_DIR` or `CRASH_ANALYSIS_PARENT`) |
| `outputDir` | Destination directory (default: `MainCrashLogsFolder/XCodeCrashLogs`) |
| `versions` | Comma-separated version filter |
| `recursive` | Search subdirectories recursively |
| `startDate` | ISO date string to filter crashes from (e.g. `2026-03-01`) |
| `endDate` | ISO date string to filter crashes until |
| `dryRun` | When `true`, shows what would be exported without writing any files |

### `notify_cliq` Parameters

| Parameter | Description |
|---|---|
| `crashDir` | Directory of symbolicated crash files (default: `SymbolicatedCrashLogsFolder`) |
| `unfixedOnly` | When `true`, only unfixed crash types are included (default: `false`) |
| `notify` | When `false`, performs a dry-run — returns the report without sending to Cliq (default: `true`) |

### `set_fix_status` Parameters

| Parameter | Description |
|---|---|
| `signature` | Crash signature string |
| `fixed` | `true` to mark as fixed, `false` to mark as unfixed |
| `note` | Optional note (e.g. PR reference) |

> **Note:** Use `set_fix_status` with `fixed: false` to mark a crash as unfixed. There is no separate "remove" tool — marking as unfixed is the recommended approach.

### `search_crashes` Parameters

| Parameter | Description |
|---|---|
| `query` | Search term (case-insensitive). E.g. `EXC_BAD_ACCESS`, `ViewController`, `SIGABRT` |
| `crashDir` | Directory of crash files to search (default: `SymbolicatedCrashLogsFolder`) |

### `clean_old_crashes` Parameters

| Parameter | Description |
|---|---|
| `beforeDate` | ISO date string — files with crash dates before this date will be deleted (e.g. `2026-03-01`) |
| `dryRun` | When `true`, reports what would be deleted without actually deleting (default: `false`) |

### `verify_dsym` Parameters

| Parameter | Description |
|---|---|
| `dsymPath` | Path to `.dSYM` bundle (defaults to `DSYM_PATH` env var) |
| `crashPath` | Path to a single `.crash` or `.ips` file to compare UUIDs against |
| `crashDir` | Directory of crash files to compare UUIDs against |

### `setup_folders` Parameters

| Parameter | Description |
|---|---|
| `masterBranchPath` | Path to master branch checkout → creates `CurrentMasterLiveBranch` symlink |
| `devBranchPath` | Path to dev branch checkout → creates `CurrentDevelopmentBranch` symlink |
| `dsymPath` | Path to .dSYM bundle → creates `dSYM_File` symlink |
| `appPath` | Path to .app bundle → creates `app_File` symlink |
| `existingCrashLogsDir` | Copy `.crash` and `.ips` files from this directory into `MainCrashLogsFolder/XCodeCrashLogs` |

---

## Standalone CLI

The CLI lets you run the crash analysis pipeline without an MCP client (useful for scheduled runs):

```bash
# Export crash logs from Xcode Organizer
node dist/cli.js export

# Dry-run export: preview what would be exported without writing files
node dist/cli.js export --dry-run

# Export crashes filtered by date range
node dist/cli.js export --start-date 2026-03-01 --end-date 2026-03-20

# Symbolicate all crash files in MainCrashLogsFolder (XCodeCrashLogs, AppticsCrashLogs, OtherCrashLogs)
node dist/cli.js batch

# Analyze crashes and print JSON report
node dist/cli.js analyze

# Analyze and save to file
node dist/cli.js analyze --crash-dir /path/to/dir -o report.json

# Send crash report to Zoho Cliq (analyzes crashes first)
node dist/cli.js notify

# Send only unfixed crashes to Cliq
node dist/cli.js notify --unfixed-only

# Dry-run: analyze but don't send to Cliq
node dist/cli.js notify --dry-run

# Analyze unfixed crashes and save the filtered report to a file
node dist/cli.js notify --unfixed-only -o unfixed_report.json

# Create folder structure with symlinks
node dist/cli.js setup --master-branch /path/to/master --dev-branch /path/to/dev --dsym /path/to/MyApp.dSYM --app /path/to/MyApp.app

# Symbolicate a single crash file
node dist/cli.js symbolicate-one --crash /path/to/crash.crash

# Frame-by-frame symbolication quality check
node dist/cli.js diagnose --crash /path/to/original.crash --symbolicated /path/to/symbolicated.crash

# List versions in .xccrashpoint files
node dist/cli.js list-versions

# Run full pipeline
node dist/cli.js pipeline

# Search for crashes matching a keyword
node dist/cli.js search --query "EXC_BAD_ACCESS"
node dist/cli.js search --query "ViewController" --crash-dir /path/to/crashes

# Delete crash files older than a given date (dry-run first)
node dist/cli.js clean --before-date 2026-03-01 --dry-run
node dist/cli.js clean --before-date 2026-03-01

# Validate a dSYM bundle and check UUID matches
node dist/cli.js verify-dsym --crash /path/to/file.crash
node dist/cli.js verify-dsym --crash-dir /path/to/crashes/ --dsym /path/to/MyApp.dSYM

# Mark a crash signature as fixed
node dist/cli.js set-fix "EXC_BAD_ACCESS SIGSEGV" --note "Fixed in PR #42"

# Mark as unfixed
node dist/cli.js unset-fix "EXC_BAD_ACCESS SIGSEGV"

# List all fix statuses
node dist/cli.js list-fixes
```

If installed globally, you can also use:

```bash
crashpoint-ios-cli analyze -o report.json
```

---

## Zoho Cliq Setup

### Channel Incoming Webhook

1. Open your Cliq channel
2. Click **More options → Incoming Webhooks**
3. Create a webhook and copy the URL
4. Set it as `ZOHO_CLIQ_WEBHOOK_URL`

The API endpoint format is:
`https://cliq.zoho.in/company/{org_id}/api/v2/channelsbyname/{channel_name}/message`

The MCP server posts `{ "text": formattedReport }` directly to this URL — no bot or Deluge script required.

---

## Zoho Projects Integration

CrashPoint can create a bug in Zoho Projects for each unique crash group. It connects to the **Zoho Projects MCP server** (already authenticated via your Claude Desktop / Cursor Zoho MCP connection) — no OAuth client credentials required.

> **No OAuth Handling in CrashPoint:** CrashPoint iOS MCP does **not** handle OAuth client ID, client secret, or token management. Authentication to Zoho Projects is handled entirely by the MCP host (Claude Desktop / Cursor) via Zoho's "Authorize Via Connection" mechanism. The `report_to_zoho_projects` tool prepares and returns structured bug payloads (title, description, severity, status) for each crash group. The MCP host, which already holds the authenticated Zoho Projects connection, then calls `create_bug` on the Zoho Projects MCP for each entry.

### Setup

1. **Connect the Zoho Projects MCP** to your Claude Desktop / Cursor configuration (via mcp.zoho.com). CrashPoint will connect to it as an MCP client.

2. **Find your Portal ID and Project ID** from the Zoho Projects URL:
   `https://projects.zoho.com/portal/{portal_name}/projects/{project_id}/...`

3. **Discover field value IDs** for status and severity. These are numeric IDs unique to your portal/project. You can find them via the Zoho Projects API or by inspecting network requests when creating a bug.

4. **Configure `.env`** with the Zoho Projects settings:

   ```dotenv
   ZOHO_PROJECTS_MCP_URL=https://mcp.zoho.com/projects/http-stream
   ZOHO_PROJECTS_PORTAL_ID=12345678
   ZOHO_PROJECTS_PROJECT_ID=87654321

   ZOHO_BUG_STATUS_OPEN=1139168000000007045
   ZOHO_BUG_STATUS_FIXED=1139168000000007049
   ZOHO_BUG_SEVERITY_SHOWSTOPPER=1139168000000007051
   ZOHO_BUG_SEVERITY_CRITICAL=1139168000000007053
   ZOHO_BUG_SEVERITY_MAJOR=1139168000000007055
   ZOHO_BUG_SEVERITY_MINOR=1139168000000007057
   ZOHO_BUG_SEVERITY_NONE=1139168000000007059
   ```

### Severity Mapping

| Exception Type | Condition | Severity |
|---|---|---|
| `EXC_BAD_ACCESS` / `SIGSEGV` / `SIGBUS` | Always | **Critical** |
| `SIGABRT` / `EXC_CRASH` | ≥10 occurrences | **Major** |
| `SIGABRT` / `EXC_CRASH` | <10 occurrences | **Minor** |
| `EXC_BREAKPOINT` / `SIGTRAP` | Always | **Major** |
| Any other | ≥20 occurrences | **ShowStopper** |
| Any other | ≥10 (and <20) occurrences | **Major** |
| Any other | 2–9 occurrences | **Minor** |
| Any other | 1 occurrence | **None** |

### Status Mapping

| Local Fix Status | Zoho Bug Status |
|---|---|
| `fixed: true` | Fixed (`ZOHO_BUG_STATUS_FIXED`) |
| `fixed: false` or not set | Open (`ZOHO_BUG_STATUS_OPEN`) |

### CLI Usage

> **Note:** Zoho Projects bug creation is **not available via the CLI** because the Zoho Projects MCP server requires browser-based OAuth authentication, which cannot be performed headlessly. Use the MCP tool from Claude Desktop or Cursor instead (see below).

### MCP Tool Usage (Claude / Cursor)

Once CrashPoint iOS MCP and the Zoho Projects MCP are both connected to your MCP host (Claude Desktop or Cursor), the host can invoke the `report_to_zoho_projects` tool to create bugs in Zoho Projects for analyzed crash groups. The MCP host handles the authenticated Zoho Projects connection.

### Cursor / Claude Desktop Configuration

Add the Zoho Projects env vars to your MCP client config (the same config file used above in the [Configuration](#configuration) section). **Do not include OAuth credentials** — the Zoho Projects MCP server handles its own authentication separately:

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
        "ZOHO_CLIQ_WEBHOOK_URL": "https://cliq.zoho.com/...",
        "ZOHO_PROJECTS_MCP_URL": "https://mcp.zoho.com/projects/http-stream",
        "ZOHO_PROJECTS_PORTAL_ID": "12345678",
        "ZOHO_PROJECTS_PROJECT_ID": "87654321",
        "ZOHO_BUG_STATUS_OPEN": "1139168000000007045",
        "ZOHO_BUG_STATUS_FIXED": "1139168000000007049",
        "ZOHO_BUG_SEVERITY_SHOWSTOPPER": "1139168000000007051",
        "ZOHO_BUG_SEVERITY_CRITICAL": "1139168000000007053",
        "ZOHO_BUG_SEVERITY_MAJOR": "1139168000000007055",
        "ZOHO_BUG_SEVERITY_MINOR": "1139168000000007057",
        "ZOHO_BUG_SEVERITY_NONE": "1139168000000007059"
      }
    }
  }
}
```

**Config file paths:**
- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Cursor:** `.cursor/mcp.json` in your project root

---

## Crash Source Tracking

Each crash file is tagged with its source:

| Source | Description |
|---|---|
| `xcode-organizer` | Exported from Xcode Organizer `.xccrashpoint` bundles |
| `apptics` | Crash reports from Apptics SDK |
| `ips-file` | Raw `.ips` crash files |
| `manual` | Manually placed crash files |

Source breakdowns appear in both the MCP analysis output and Zoho Cliq reports (e.g. `Xcode Organizer(3), Apptics(1)`).

---

## Fix Status in Reports

When crashes are analyzed, each group shows its fix status if one has been set:

- `[FIXED] Fixed in dev — Fixed in PR #42`
- `[NOT FIXED] Not yet fixed`

Fix statuses are stored in `{CRASH_ANALYSIS_PARENT}/fix_status.json` (local only, gitignored).

Use the `set_fix_status` MCP tool to mark crash signatures as fixed (`fixed: true`) or unfixed (`fixed: false`).

---

## Local Fix Tracking

```json
{
  "EXC_BAD_ACCESS||MyApp  -[ViewController load]||...": {
    "fixed": true,
    "note": "Fixed in PR #42",
    "updatedAt": "2026-03-22T16:00:00.000Z"
  }
}
```

This file is local-only (gitignored) and tracks which crash types your team has resolved.

---

## Symbolication Notes

- Symbolicated files are written to `SymbolicatedCrashLogsFolder/` with the same filename
- Symbolication uses Xcode's `symbolicatecrash` tool, which automatically processes all threads and all binaries

---

## License

MIT
