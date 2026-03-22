# CrashPoint iOS MCP

A **TypeScript MCP (Model Context Protocol) server** that wraps the CrashPoint iOS crash analysis pipeline as MCP tools. Use it with Claude Desktop, Cursor, and other MCP clients to export, symbolicate, analyze, and report iOS/macOS crash logs — all through natural language.

---

## What It Does

CrashPoint iOS MCP gives your AI assistant the ability to:

1. **Export** `.crash` files from Xcode Organizer `.xccrashpoint` bundles
2. **Symbolicate** crashes using `atos` and your `.dSYM` bundle
3. **Analyze & group** symbolicated crashes by unique signature, device, iOS version, and app version
4. **Report** crash analysis to your Zoho Cliq channel or bot
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

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "crashpoint-ios": {
      "command": "npx",
      "args": ["crashpoint-ios-mcp"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "/path/to/ParentHolderFolder",
        "DSYM_PATH": "/path/to/MyApp.dSYM",
        "APP_PATH": "/path/to/MyApp.app",
        "APP_NAME": "MyApp",
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
      "args": ["crashpoint-ios-mcp"],
      "env": {
        "CRASH_ANALYSIS_PARENT": "/path/to/ParentHolderFolder",
        "DSYM_PATH": "/path/to/MyApp.dSYM",
        "APP_PATH": "/path/to/MyApp.app",
        "APP_NAME": "MyApp",
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
| `CRASH_ANALYSIS_PARENT` | **Yes** | Path to your ParentHolderFolder (holds BasicCrashLogsFolder and SymbolicatedCrashLogsFolder) |
| `DSYM_PATH` | Recommended | Path to `MyApp.dSYM` bundle — required for symbolication |
| `APP_PATH` | Recommended | Path to `MyApp.app` bundle |
| `APP_NAME` | Optional | App binary name (e.g. `MyApp`) — used to filter frames in reports |
| `CRASH_INPUT_DIR` | Optional | Override the directory searched for `.xccrashpoint` files (defaults to `CRASH_ANALYSIS_PARENT`) |
| `CRASH_VERSIONS` | Optional | Comma-separated version filter for exports (e.g. `3.2.0 (456),3.1.0 (450)`) |
| `ZOHO_CLIQ_WEBHOOK_URL` | Optional | Incoming webhook URL for a Zoho Cliq channel |
| `ZOHO_CLIQ_BOT_WEBHOOK_URL` | Optional | Bot webhook URL — tried first, falls back to channel webhook |

---

## Folder Structure

CrashPoint iOS MCP uses a `ParentHolderFolder` to organize crash data:

```
ParentHolderFolder/           ← CRASH_ANALYSIS_PARENT
├── BasicCrashLogsFolder/     ← Exported raw .crash files
├── SymbolicatedCrashLogsFolder/  ← Symbolicated .crash files
└── fix_status.json           ← Local fix tracking database
```

Run the `setup_folders` tool to create this structure automatically.

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
| `analyze_crashes` | Group & deduplicate crashes by signature, count by device/iOS/app version |
| `notify_cliq` | Send crash analysis report to Zoho Cliq |
| `set_fix_status` | Mark a crash signature as fixed or unfixed |
| `remove_fix_status` | Remove fix tracking for a crash signature |
| `list_fix_statuses` | Show all locally tracked fix statuses |
| `run_full_pipeline` | Run the complete pipeline: export → symbolicate → analyze → (optionally notify) |
| `setup_folders` | Create the ParentHolderFolder directory structure |

---

## Usage Examples

Ask Claude or Cursor:

> "Export my latest crashes from Xcode Organizer for version 3.2.0"

> "Symbolicate all crashes in my BasicCrashLogsFolder"

> "Analyze my symbolicated crashes and show me the top crash groups"

> "Send the crash analysis report to our Cliq channel"

> "Run the full crash analysis pipeline and notify the team"

> "Mark the EXC_BAD_ACCESS crash as fixed with note 'Fixed in PR #42'"

> "Show me all crash types we've marked as fixed"

> "What app versions are in my Xcode Organizer crash data?"

---

## Zoho Cliq Setup

### Channel Incoming Webhook

1. Open your Cliq channel
2. Click **More options → Incoming Webhooks**
3. Create a webhook and copy the URL
4. Set it as `ZOHO_CLIQ_WEBHOOK_URL`

### Bot Webhook

1. Create a Zoho Cliq Bot in your organization
2. Add it to a channel and get the bot webhook URL
3. Set it as `ZOHO_CLIQ_BOT_WEBHOOK_URL`

The MCP server tries the bot webhook first, then falls back to the channel webhook.

---

## Crash Source Tracking

Each crash file is tagged with its source:

| Source | Description |
|---|---|
| `xcode-organizer` | Exported from Xcode Organizer `.xccrashpoint` bundles |
| `apptics` | Crash reports from Apptics SDK |
| `ips-file` | Raw `.ips` crash files |
| `manual` | Manually placed crash files |

---

## Local Fix Tracking

The `set_fix_status` tool stores fix state in `{CRASH_ANALYSIS_PARENT}/fix_status.json`:

```json
{
  "EXC_BAD_ACCESS||MyApp  -[ViewController load]||...": {
    "fixed": true,
    "note": "Fixed in PR #42",
    "updatedAt": "2026-03-22T16:00:00.000Z"
  }
}
```

This file is local-only (in `.gitignore`) and is used to track which crash types your team has resolved.

---

## Symbolication Notes

- Symbolication requires **macOS** and **Xcode CLI tools** — `atos` is a macOS-only tool
- The `atos` binary is found inside the `.dSYM` bundle at `Contents/Resources/DWARF/`
- By default, only the **crashed thread** is symbolicated (pass `allThreads: true` to symbolicate all)
- Symbolicated files are written to `SymbolicatedCrashLogsFolder/` with the same filename

---

## License

MIT
