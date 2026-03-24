# CrashPoint iOS MCP

A **TypeScript MCP (Model Context Protocol) server** that wraps the CrashPoint iOS crash analysis pipeline as MCP tools. Use it with Claude Desktop, Cursor, and other MCP clients to export, symbolicate, analyze, and report iOS/macOS crash logs — all through natural language.

Also includes a standalone **CLI** (`crashpoint-ios-cli`) for scheduled runs without an AI client.

---

## What It Does

CrashPoint iOS MCP gives your AI assistant the ability to:

1. **Export** `.crash` files from Xcode Organizer `.xccrashpoint` bundles
2. **Symbolicate** crashes using `atos` and your `.dSYM` bundle
3. **Analyze & group** symbolicated crashes by unique signature, device, iOS version, and app version
4. **Report** crash analysis to your Zoho Cliq channel (including fix status and source labels)
5. **Track fixes** locally so your team can mark crash types as resolved

---

## Prerequisites

- **macOS** (required for `atos` symbolication)
- **Node.js 18+**
- **Xcode CLI tools** (`xcode-select --install`)
- A `.dSYM` bundle for your app
- A `.app` bundle for your app
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

### Claude Desktop

Add to your `claude_desktop_config.json`:

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

**macOS location:** `~/Library/Application Support/Claude/claude_desktop_config.json`

### Cursor

Create or update `.cursor/mcp.json` in your project:

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

---

## Folder Structure

CrashPoint iOS MCP uses a `ParentHolderFolder` to organize crash data:

```
ParentHolderFolder/                   ← CRASH_ANALYSIS_PARENT
├── BasicCrashLogsFolder/             ← Exported raw .crash files
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

| Tool | Description |
|---|---|
| `list_versions` | List all app versions found in `.xccrashpoint` files |
| `preview_export` | Dry-run: show what would be exported without writing files |
| `export_crashes` | Export `.crash` files from `.xccrashpoint` packages to BasicCrashLogsFolder |
| `symbolicate_one` | Symbolicate a single `.crash` file using `atos` |
| `symbolicate_batch` | Batch symbolicate all crashes in BasicCrashLogsFolder |
| `diagnose_frames` | Frame-by-frame diff: shows which frames were resolved vs missed |
| `analyze_crashes` | Group & deduplicate crashes by signature; includes fix status |
| `notify_cliq` | Send crash analysis report to Zoho Cliq (includes source labels + fix status) |
| `set_fix_status` | Mark a crash signature as fixed or unfixed |
| `remove_fix_status` | Remove fix tracking for a crash signature |
| `list_fix_statuses` | Show all locally tracked fix statuses |
| `run_full_pipeline` | Run the complete pipeline: export → symbolicate → analyze → (optionally notify) |
| `setup_folders` | Create folder structure + optional branch symlinks + copy existing crash files |
| `notify_unfixed_cliq` | Analyze crashes, filter to unfixed only, and send filtered report to Cliq |
| `report_to_zoho_projects` | Analyze crashes and create a Zoho Projects bug for each unique crash group (status + severity auto-mapped) |

### `setup_folders` Parameters

| Parameter | Description |
|---|---|
| `masterBranchPath` | Path to master branch checkout → creates `CurrentMasterLiveBranch` symlink |
| `devBranchPath` | Path to dev branch checkout → creates `CurrentDevelopmentBranch` symlink |
| `dsymPath` | Path to .dSYM bundle → creates `dSYM_File` symlink |
| `appPath` | Path to .app bundle → creates `app_File` symlink |
| `existingCrashLogsDir` | Copy `.crash` and `.ips` files from this directory into `BasicCrashLogsFolder` |

---

## Standalone CLI

The CLI lets you run the crash analysis pipeline without an MCP client (useful for scheduled runs):

```bash
# Export crash logs from Xcode Organizer
node dist/cli.js export

# Symbolicate all crash files in BasicCrashLogsFolder
node dist/cli.js batch

# Analyze crashes and print JSON report
node dist/cli.js analyze

# Analyze and save to file
node dist/cli.js analyze --crash-dir /path/to/dir -o report.json

# Send a saved report to Zoho Cliq
node dist/cli.js notify --report report.json

# Analyze crashes, filter to unfixed only, and send filtered report to Cliq
node dist/cli.js notify-unfixed

# Dry-run: analyze and filter but don't send to Cliq
node dist/cli.js notify-unfixed --dry-run

# Analyze unfixed crashes and save the filtered report to a file
node dist/cli.js notify-unfixed -o unfixed_report.json

# Create folder structure with symlinks
node dist/cli.js setup --master-branch /path/to/master --dev-branch /path/to/dev --dsym /path/to/MyApp.dSYM --app /path/to/MyApp.app

# Symbolicate a single crash file
node dist/cli.js symbolicate-one --crash /path/to/crash.crash

# Frame-by-frame symbolication quality check
node dist/cli.js diagnose --crash /path/to/original.crash --symbolicated /path/to/symbolicated.crash

# List versions in .xccrashpoint files
node dist/cli.js list-versions

# Run full pipeline
node dist/cli.js pipeline --notify

# Mark a crash signature as fixed
node dist/cli.js set-fix "EXC_BAD_ACCESS SIGSEGV" --note "Fixed in PR #42"

# Mark as unfixed
node dist/cli.js unset-fix "EXC_BAD_ACCESS SIGSEGV"

# List all fix statuses
node dist/cli.js list-fixes

# Remove fix tracking
node dist/cli.js remove-fix "EXC_BAD_ACCESS SIGSEGV"

# Create Zoho Projects bugs for all crash groups
node dist/cli.js report-zoho

# Create bugs for unfixed crashes only
node dist/cli.js report-zoho --unfixed-only

# Override portal/project IDs
node dist/cli.js report-zoho --portal-id 123 --project-id 456
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

CrashPoint can automatically create a Zoho Projects bug for each unique crash group, with **severity** (mapped from exception type and occurrence count) and **status** (mapped from your local fix tracking).

### Architecture

Two MCP servers run side-by-side in Claude Desktop / Cursor:
- **CrashPoint MCP** — analyzes crashes and calls `report_to_zoho_projects`
- **Zoho Projects MCP** (from mcp.zoho.com) — receives the `create_bug` tool calls

The CLI `report-zoho` command connects directly to the Zoho Projects MCP server via SSE as an MCP client, so the full pipeline can run in a scheduled job without Claude.

### Setup

#### 1. Get your Zoho Projects MCP URL

You need a Zoho account with access to Zoho Projects.

1. Go to [mcp.zoho.com](https://mcp.zoho.com) (sign in with your Zoho account)
2. Add Zoho Projects tools and copy the MCP Server URL
3. Set `ZOHO_PROJECTS_MCP_URL` in your `.env`

#### 2. Find your Portal & Project IDs

Ask Claude (with the Zoho Projects MCP configured):
> "List my Zoho Projects portals"
> "List projects in portal 123456"

Or find them in the Zoho Projects URL: `https://projects.zoho.com/portal/{portal_name}/projects/{project_id}`

Set `ZOHO_PROJECTS_PORTAL_ID` and `ZOHO_PROJECTS_PROJECT_ID` in your `.env`.

#### 3. Find Bug Field Value IDs

Status and severity in Zoho use numeric IDs that are unique to your portal/project. Ask Claude:
> "Using Zoho Projects, list all bug fields and their allowed values for my project"

Copy the IDs for **Open**, **Fixed**, **Critical**, **Major**, **Minor** into your `.env`:

```dotenv
ZOHO_BUG_STATUS_OPEN=1139168000000007045
ZOHO_BUG_STATUS_FIXED=1139168000000007051
ZOHO_BUG_SEVERITY_CRITICAL=1139168000000007061
ZOHO_BUG_SEVERITY_MAJOR=1139168000000007063
ZOHO_BUG_SEVERITY_MINOR=1139168000000007065
```

> **Note:** If you don't set these IDs, bugs will still be created — just without status/severity fields.

### Configuration

Add to your `.env`:

```dotenv
ZOHO_PROJECTS_MCP_URL=https://mcp.zoho.com/...
ZOHO_PROJECTS_PORTAL_ID=your-portal-id
ZOHO_PROJECTS_PROJECT_ID=your-project-id
ZOHO_BUG_STATUS_OPEN=
ZOHO_BUG_STATUS_FIXED=
ZOHO_BUG_SEVERITY_CRITICAL=
ZOHO_BUG_SEVERITY_MAJOR=
ZOHO_BUG_SEVERITY_MINOR=
```

| Variable | Description |
|---|---|
| `ZOHO_PROJECTS_MCP_URL` | Zoho Projects MCP server URL from mcp.zoho.com |
| `ZOHO_PROJECTS_PORTAL_ID` | Your Zoho Projects portal ID |
| `ZOHO_PROJECTS_PROJECT_ID` | Your Zoho Projects project ID |
| `ZOHO_BUG_STATUS_OPEN` | Zoho bug status field value ID for "Open" |
| `ZOHO_BUG_STATUS_FIXED` | Zoho bug status field value ID for "Fixed" |
| `ZOHO_BUG_SEVERITY_CRITICAL` | Zoho bug severity field value ID for "Critical" |
| `ZOHO_BUG_SEVERITY_MAJOR` | Zoho bug severity field value ID for "Major" |
| `ZOHO_BUG_SEVERITY_MINOR` | Zoho bug severity field value ID for "Minor" |

### Claude Desktop Config Example

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
        "ZOHO_PROJECTS_MCP_URL": "https://mcp.zoho.com/...",
        "ZOHO_PROJECTS_PORTAL_ID": "your-portal-id",
        "ZOHO_PROJECTS_PROJECT_ID": "your-project-id",
        "ZOHO_BUG_STATUS_OPEN": "1139168000000007045",
        "ZOHO_BUG_STATUS_FIXED": "1139168000000007051",
        "ZOHO_BUG_SEVERITY_CRITICAL": "1139168000000007061",
        "ZOHO_BUG_SEVERITY_MAJOR": "1139168000000007063",
        "ZOHO_BUG_SEVERITY_MINOR": "1139168000000007065"
      }
    }
  }
}
```

### CLI Usage

```bash
# Create bugs for all crash groups
node dist/cli.js report-zoho

# Create bugs for unfixed crashes only
node dist/cli.js report-zoho --unfixed-only

# Override portal/project IDs
node dist/cli.js report-zoho --portal-id 123 --project-id 456

# Use a specific crash directory
node dist/cli.js report-zoho --crash-dir /path/to/symbolicated --unfixed-only
```

### MCP Tool Usage

The `report_to_zoho_projects` tool lets Claude/Cursor create Zoho bugs natively — no separate Zoho MCP orchestration needed for this flow:

> "Create Zoho Projects bugs for all my unfixed crashes"

> "Report my crash analysis to Zoho Projects"

### Severity Mapping

| Exception Type | Severity |
|---|---|
| `EXC_BAD_ACCESS`, `SIGSEGV`, `SIGBUS` | Critical |
| `SIGABRT`, `EXC_CRASH` with ≥10 occurrences | Critical |
| `SIGABRT`, `EXC_CRASH` with <10 occurrences | Major |
| `EXC_BREAKPOINT`, `SIGTRAP` | Major |
| `EXC_RESOURCE` | Minor |
| Other with ≥20 occurrences | Critical |
| Other with ≥5 occurrences | Major |
| Other with <5 occurrences | Minor |

### Status Mapping

| CrashPoint Fix Status | Zoho Bug Status |
|---|---|
| Marked as fixed (`set_fix_status`) | `ZOHO_BUG_STATUS_FIXED` ID |
| Not fixed / not tracked | `ZOHO_BUG_STATUS_OPEN` ID |

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

Use the `set_fix_status` MCP tool or ask Claude:

> "Mark the EXC_BAD_ACCESS crash as fixed with note 'Fixed in PR #42'"

---

## AI Analysis

AI-powered analysis (pattern insights, root cause suggestions, priority ranking) is a **separate manual step** — it is not part of the automated scheduled pipeline. Use Claude Desktop with the MCP tools for interactive analysis:

> "Analyze my symbolicated crashes and tell me which ones are most critical"

> "Which crash groups are still unfixed?"

> "Summarize the top 3 crashes for our next sprint"

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

- Symbolication requires **macOS** and **Xcode CLI tools** — `atos` is macOS-only
- By default, only the **crashed thread** is symbolicated (pass `allThreads: true` to symbolicate all)
- Symbolicated files are written to `SymbolicatedCrashLogsFolder/` with the same filename

---

## License

MIT
