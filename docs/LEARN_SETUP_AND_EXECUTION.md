# CrashPoint iOS MCP — Setup & Execution Guide

> This guide is the deep-dive companion to the README. It explains the *why*, the *how it works under the hood*, and the *step-by-step walkthrough* — things the README does not cover.

---

## 1. Who Is This For & What You'll Learn

This guide is for **Developers** and **QA** who need to:

- Understand what the CrashPoint iOS MCP server actually does when it runs.
- Set up the workspace from scratch for the first time.
- Run the automated bash pipeline from the Terminal and know what each step is doing.
- Configure Claude CLI permissions so the fully automated (non-interactive) pipeline does not pause and hang waiting for human input.
- Verify that the full end-to-end flow is working correctly.
- Diagnose common problems when something goes wrong.

By the end of this guide you will have a working, scheduled, automated crash analysis pipeline that runs every day without any manual intervention.

---

## 2. Concepts: What Is MCP and Why It Matters Here

### What is MCP?

**MCP** stands for **Model Context Protocol**. It is an open standard that lets an AI assistant (like Claude) call external "tools" that you define on a server. It is like a plugin system — instead of Claude being limited to what it knows, MCP lets Claude reach out and use real software tools.

When the AI client (Claude Desktop, Cursor, or the `claude` CLI) starts up, it spawns the MCP server as a child process. They communicate through **stdio** — the client writes JSON messages to the server's standard input, and the server writes JSON responses back on standard output. It is just two processes talking through their standard streams.

### Why does CrashPoint iOS MCP use this?

CrashPoint iOS MCP wraps the entire crash analysis pipeline as a set of MCP tools. Each step — exporting crash files, symbolicating them, analyzing and grouping them, sending a Cliq notification, creating Zoho Projects bugs — is exposed as a named tool that Claude can call.

This means, you can describe what you want in plain English and Claude figures out which tools to call, in what order, with what parameters. Claude handles the orchestration; CrashPoint handles the execution.

### The two ways to use it

| Mode | How it works |
|---|---|
| **Interactive (Claude Desktop / Cursor)** | You chat with Claude. It calls MCP tools on your behalf as part of the conversation. |
| **Automated (bash script + `claude` CLI)** | A shell script constructs a detailed prompt and calls `claude -p` (non-interactive, "print" mode). Claude reads the prompt, calls the tools autonomously, and exits when done. A log is saved. |

The automated mode is what runs on a daily schedule. The interactive mode is great for ad-hoc analysis.

---

## 3. How the Config System Works (The Layered Approach)

Understanding the config loading order will save you a lot of debugging time.

### The loading chain (from `src/config.ts`)

When the MCP server starts, it loads configuration in this exact order:

1. **Check `CRASH_ANALYSIS_PARENT`** — the server reads this environment variable to find the parent folder. This is the *only* env var the MCP client needs to provide; it is the single entry point into all other configuration.

2. **Read `crashpoint.config.json`** — the server reads `<CRASH_ANALYSIS_PARENT>/crashpoint.config.json` and loads all keys from it into memory.

3. **Merge with environment variables** — **environment variables always win**. If the same key appears in the JSON file and as an env var, the env var value is used.

### What this means in practice

- Your `crashpoint.config.json` is your central configuration file. Set everything there.
- If you need a specific MCP client to use a *different* value for one key (for example, pointing a second client at a different `.dSYM`), you can add that key to the `env` block in the client's MCP config. It will override just that key without touching the JSON file.
- `CRASH_ANALYSIS_PARENT` is the **only required environment variable**. Everything else lives in the JSON config file and does not need to appear in the MCP client config.

### Optional override path

There is also a `CRASHPOINT_CONFIG_PATH` env var (undocumented shortcut) that lets you point the server at a config file in a completely different location. This is useful if you need multiple independent config files on the same machine.

---

## 4. Step-by-Step First-Time Setup Walkthrough

### Step 1 — Verify prerequisites

Before doing anything else, confirm you have everything required:

```bash
# Check macOS (required for Xcode toolchain)
sw_vers

# Check Node.js version (must be 18 or higher)
node --version

# Install Xcode Command Line Tools if not already installed
xcode-select --install

# Confirm symbolicatecrash is available after Xcode install
xcrun --find symbolicatecrash

# Install jq (used by the bash automation script to parse Claude's output)
brew install jq
jq --version
```

> **Note:** `jq` is only needed for the automated bash pipeline. If you only plan to use the interactive Claude Desktop / Cursor mode, you can skip `jq` for now.

### Step 2 — Clone & build the repo

```bash
git clone https://github.com/maanasa-s-5539/CrashPoint-IOS-MCP.git
cd CrashPoint-IOS-MCP
npm install
npm run build
```

After `npm run build`, the compiled output will be in the `dist/` folder. The two entry points are:

- `dist/core-server.js` — the MCP server binary (spawned by AI clients).
- `dist/cli.js` — the standalone CLI for running pipeline steps without an AI client.

### Step 3 — Create the config file

Choose a folder on your Mac that will hold all crash data. This is your **ParentHolderFolder** (the value of `CRASH_ANALYSIS_PARENT`). It can be anywhere — for example `/Users/yourname/CrashAnalysis/MyApp`.

Copy the example config into that folder:

```bash
cp crashpoint.config.example.json /Users/yourname/CrashAnalysis/MyApp/crashpoint.config.json
```

Now open `crashpoint.config.json` and fill in your values. Here is what each group of keys means and where to find the values:

#### Core paths

| Key | What it is | Where to find it |
|---|---|---|
| `CRASH_ANALYSIS_PARENT` | The folder you just created | The absolute path of the folder, e.g. `/Users/yourname/CrashAnalysis/MyApp` |
| `DSYM_PATH` | Path to your app's `.dSYM` bundle | Inside your Xcode archive: right-click the archive in Xcode Organizer → "Show in Finder" → open `.xcarchive/dSYMs/MyApp.app.dSYM` |
| `APP_PATH` | Path to your `.app` bundle | Same archive: `.xcarchive/Products/Applications/MyApp.app` |
| `APP_NAME` | The binary name of your app | The filename without `.app`, e.g. `MyApp` |
| `MASTER_BRANCH_PATH` | Path to your master/live Git checkout | Wherever you have your master branch checked out locally |
| `DEV_BRANCH_PATH` | Path to your dev/feature Git checkout | Wherever you have your development branch checked out locally |
| `CLAUDE_CLI_PATH` | Absolute path to the `claude` binary | Run `which claude` in Terminal after installing Claude CLI |

#### Crash window settings

These three keys control *which* crashes are fetched during the daily run:

- `CRASH_DATE_OFFSET` — how many days before today to use as the **end** date of the window. For example, `"4"` means the window ends 4 days ago.
- `CRASH_NUM_DAYS` — the **width** of the window in days (1–180). For example, `"1"` means a single day.
- `CRASH_VERSIONS` — a comma-separated list of app versions to filter by, e.g. `"2.4.1,2.4.0"`.

The date math works like this:

```
endDate   = today − CRASH_DATE_OFFSET
startDate = endDate − CRASH_NUM_DAYS + 1
```

For example, with `CRASH_DATE_OFFSET=4` and `CRASH_NUM_DAYS=1`, if today is April 15, the window covers April 11 (one day, four days ago).

#### Apptics integration keys

| Key | Description |
|---|---|
| `APP_DISPLAY_NAME` | The human-readable name shown in prompts and notifications |
| `APPTICS_MCP_NAME` | The name of your Apptics MCP server as listed by `claude mcp list` |
| `APPTICS_PORTAL_ID` | Your Apptics portal ID (`zsoid`) — found in the Apptics portal URL |
| `APPTICS_PROJECT_ID` | Your Apptics project ID — found in the Apptics project settings page |
| `APPTICS_APP_NAME` | The app name exactly as it appears inside Apptics |

#### Zoho Projects bug fields

These IDs are used when creating or updating bugs in Zoho Projects. To find them:

1. Go to your Zoho Projects portal → **Settings** → **Bug Tracker** → **Status** and **Severity** tabs.
2. Each status and severity has a unique internal ID. You can extract these by inspecting the Zoho Projects API response when calling the bugs endpoint, or by asking your Zoho Projects administrator.

| Key | What it maps to |
|---|---|
| `ZOHO_BUG_STATUS_OPEN` | ID of the "Open" bug status |
| `ZOHO_BUG_STATUS_FIXED` | ID of the "Fixed" bug status |
| `ZOHO_BUG_SEVERITY_SHOWSTOPPER` | ID used when a crash has 50+ occurrences |
| `ZOHO_BUG_SEVERITY_CRITICAL` | ID used for 20–49 occurrences |
| `ZOHO_BUG_SEVERITY_MAJOR` | ID used for 5–19 occurrences |
| `ZOHO_BUG_SEVERITY_MINOR` | ID used for 2–4 occurrences |
| `ZOHO_BUG_SEVERITY_NONE` | ID used for fewer than 2 occurrences |
| `ZOHO_BUG_APP_VERSION` | The internal field name of your "App Version" custom field |
| `ZOHO_BUG_NUM_OF_OCCURRENCES` | The internal field name of your "Occurrences" custom field |

#### Zoho Cliq webhook

`ZOHO_CLIQ_WEBHOOK_URL` is the URL for an incoming webhook in a Zoho Cliq channel. To create one:

1. Open Zoho Cliq → create the channel where you want crash notifications.
2. Click on your display picture → **Bots & Tools** → **Webhook Tokens** → **Create a token**.
3. Copy the generated token and keep it safe.
4. Copy the API endpoint of the channel, append &apikey=<copied, generated token>.
5. Paste the full API endpoint into the config.json.

#### Scheduled run time

`SCHEDULED_RUN_TIME` controls when the macOS launchd job fires each day. Format is `HH:MM` in 24-hour time, e.g. `"11:00"` for 11 AM.

### Step 4 — Run `setup_folders`

This single command does all the heavy lifting for workspace initialization. You can run it either through Claude (by asking it to call the `setup_folders` tool) or via the CLI:

```bash
CRASH_ANALYSIS_PARENT=/path/to/ParentHolderFolder \
  node dist/cli.js setup \
  --master-branch /path/to/master \
  --dev-branch /path/to/dev \
  --dsym /path/to/MyApp.app.dSYM \
  --app /path/to/MyApp.app
```

`setup_folders` creates (if they don't already exist):

- The full folder tree under `ParentHolderFolder` (see the README for the tree diagram).
- `.mcp.json` in `ParentHolderFolder` — auto-generated for use by the Claude CLI automation pipeline.
- The macOS launchd plist at `~/Library/LaunchAgents/com.crashpipeline.daily_mcp.plist` — used to schedule the daily run.
- Three automation files inside `Automation/`:
  - `run_crash_pipeline.sh` — the main bash script. During setup, the placeholder `<REPLACE_WITH_PATH_TO_PARENT_HOLDER_FOLDER>` inside the script is automatically substituted with your actual `ParentHolderFolder` path.
  - `daily_crash_pipeline_prompt_phase1.md` — the Phase 1 prompt template.
  - `daily_crash_pipeline_prompt_phase2.md` — the Phase 2 prompt template.
- Symlinks for `dSYM_File`, `app_File`, `CurrentMasterLiveBranch`, and `CurrentDevelopmentBranch` inside `ParentHolderFolder`.

> **Note:** `setup_folders` never overwrites files that already exist, so running it again is safe. If you need to update the automation files to the latest version (for example after a CrashPoint update), run it with `force=true` as an MCP parameter or use the `setup_automation_files` MCP tool with `force=true`.

### Step 5 — Register the MCP server with your AI client

#### Claude Desktop (macOS)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add:

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

#### Cursor

Add the same block to `.cursor/mcp.json` in your project root.

#### Using the auto-generated `.mcp.json`

`setup_folders` also writes a `.mcp.json` file directly into `ParentHolderFolder`. The Claude CLI automation script uses this file automatically when it runs from inside `ParentHolderFolder`. You do not need to edit this file — it is regenerated from your config.

---

## 5. How the Bash Pipeline Script Works (`run_crash_pipeline.sh`)

`run_crash_pipeline.sh` is the heart of the automated daily run. It lives in `ParentHolderFolder/Automation/` after you run `setup_folders`. Here is a detailed walkthrough of what it does, step by step.

### Startup & validation

The script starts with `set -euo pipefail`, which means it will exit immediately on any error, on any unset variable, or if any command in a pipe fails.

It then:

1. Reads `crashpoint.config.json` using `node -e` calls to extract individual values: `APP_DISPLAY_NAME`, `APPTICS_MCP_NAME`, `CLAUDE_CLI_PATH`, `MASTER_BRANCH_PATH`, and `DEV_BRANCH_PATH`.
2. Validates that the config file exists and contains valid JSON.
3. Validates that `APP_DISPLAY_NAME` and `CLAUDE_CLI_PATH` are non-empty.
4. Checks that the Claude CLI binary exists and is executable.
5. Checks that `jq` is installed and available in `PATH`.

If any of these checks fail, the script exits immediately with an error message and a non-zero exit code.

### Prompt template parsing

Both `daily_crash_pipeline_prompt_phase1.md` and `daily_crash_pipeline_prompt_phase2.md` have **YAML frontmatter** at the top — a block between `---` markers that specifies the model and effort level for that phase. For example:

```
---
model: claude-sonnet-4-5
effort: medium
---
```

The script uses `sed` to:
1. Extract the `model` and `effort` values from the frontmatter.
2. Strip the frontmatter block and get the raw prompt body text.

This means you can change which model is used for each phase simply by editing the prompt file's frontmatter — no changes to the script needed.

### Placeholder substitution

The Phase 1 prompt body contains `{{APPTICS_MCP_NAME}}` placeholders — these are replaced with the actual MCP server name from your config before the prompt is sent to Claude.

If `APPTICS_MCP_NAME` is empty (you are not using Apptics), any lines in the Phase 1 prompt that contain `{{APPTICS_MCP_NAME}}` are removed entirely, so the prompt remains clean.

Phase 2 has no placeholders and is used as-is after frontmatter stripping.

### Allowed tools construction

The script dynamically builds the `--allowedTools` flag:

```bash
ALLOWED_TOOLS="mcp__crashpoint-ios__*"
if [ -n "$APPTICS_MCP_NAME" ]; then
  ALLOWED_TOOLS="${ALLOWED_TOOLS},mcp__${APPTICS_MCP_NAME}__*"
fi
```

The `*` wildcard grants access to all tools under that MCP server. If you have Apptics configured, its tools are also included.

### Phase 1 execution — Data collection & reporting

Phase 1 instructs Claude to:
1. Download crash data from Apptics via the Apptics MCP tools.
2. Save Apptics crashes as `.crash` files using the `save_apptics_crashes` tool.
3. Run the full pipeline: `export_crashes` → `symbolicate_batch` → `analyze_crashes`.
4. Send a notification to Zoho Cliq via `notify_cliq`.
5. Create or update Zoho Projects bugs via `prepare_project_bugs` and the Apptics MCP's bug tools.

### Phase 2 execution — Crash cause analysis & fix plan

Phase 2 instructs Claude to:
1. Read the latest crash analysis report from `AnalyzedReportsFolder/latest.json`.
2. Examine the source code in the master and dev branch directories to understand the crash context.
3. Produce a `LatestFixPlan.md` document in `Automation/FixPlans/` with root cause analysis and concrete fix suggestions.

> **Warning:** Phase 2 requires Claude to read source code files from your branch directories. These paths **must** be pre-authorized in `~/.claude/settings.json`. Without this, Claude will pause and ask for permission on every file read, which breaks the non-interactive automated run. See Section 7 for details.

### Logging

Every run creates a timestamped log file:

```
ParentHolderFolder/Automation/ScheduledRunLogs/pipeline_YYYY-MM-DD_HH-MM-SS.log
```

Both stdout and stderr from Claude are captured in this file. The Phase 1 header, Phase 2 header, Claude's text responses, and the final exit code summary all appear in the log.

### Cleanup

After each phase, the script runs:

```bash
find "$PARENT_HOLDER_FOLDER" -maxdepth 1 -type f \( -name "*.jq" -o -name "*.sh" \) -delete
```

This removes any stray `.jq` or `.sh` files that Claude may have created as scratch files in `ParentHolderFolder` during its run.

### Exit code handling

- If Phase 1 fails (non-zero exit code), Phase 2 is **skipped entirely** and the script exits with Phase 1's exit code.
- If Phase 2 fails, the script exits with Phase 2's exit code.
- If both phases fail, the final exit code is whichever is higher.
- If both succeed, the script exits with `0`.

### Running the script manually from Terminal

To run it in the foreground (output appears directly in your terminal):

```bash
cd /path/to/ParentHolderFolder/Automation
bash run_crash_pipeline.sh
```

To run it in the background and watch the log as it grows:

```bash
bash /path/to/ParentHolderFolder/Automation/run_crash_pipeline.sh &
tail -f /path/to/ParentHolderFolder/Automation/ScheduledRunLogs/pipeline_*.log
```

> **Note:** The `tail -f` with a glob pattern will follow the most recently created log file. If you run multiple times in quick succession you may need to specify the exact filename.

---

## 6. Scheduled Automation with macOS launchd

`setup_folders` auto-generates a launchd plist file at:

```
~/Library/LaunchAgents/com.crashpipeline.daily_mcp.plist
```

This file tells macOS to run `run_crash_pipeline.sh` automatically every day at the time specified by `SCHEDULED_RUN_TIME` in your config (default: 11:00 AM).

### Loading and unloading the job

```bash
# Register the job with macOS (run once after setup_folders)
launchctl load ~/Library/LaunchAgents/com.crashpipeline.daily_mcp.plist

# Unregister the job (if you want to stop scheduled runs)
launchctl unload ~/Library/LaunchAgents/com.crashpipeline.daily_mcp.plist
```

### Testing the job immediately

To trigger the job right now without waiting for the scheduled time:

```bash
launchctl start com.crashpipeline.daily_mcp
```

### Checking launchd stdout/stderr

The plist redirects the script's stdout and stderr to:

- `/tmp/crashpipeline_stdout.log`
- `/tmp/crashpipeline_stderr.log`

Check these files if the job runs but produces no output in the run log, or if you need to see startup errors before the script's own logging kicks in.

### Confirming the job is loaded

```bash
launchctl list | grep crashpipeline
```

If the job is loaded, it will appear in the list with its PID (if currently running) or `0` (if idle).

### Handling macOS sleep

> **⚠️ Warning:** macOS launchd jobs will not run if the Mac is asleep at the scheduled time. Instead, the job will run the next time the Mac wakes up.

To guarantee the pipeline runs at the configured time, set a wake event a few minutes before:

```bash
# Example: wake at 10:55 AM every day if SCHEDULED_RUN_TIME is "11:00"
sudo pmset repeat wakeorpoweron MTWRFSU 10:55:00
```

The letters `MTWRFSU` stand for Monday through Sunday. Adjust as needed.

---

## 7. Claude CLI Permissions Setup (CRITICAL)

This is the most important section for the automated pipeline. If you skip it, Claude will pause and prompt for permission on every tool call, which completely breaks non-interactive (`-p`) runs.

### Where the settings file lives

```
~/.claude/settings.json
```

Create it if it does not exist.

### Why this is necessary

The `--allowedTools` flag in the bash script tells Claude **which tools exist and can be used in this session**. But Claude also has its own permission layer in `settings.json` that controls **whether it is actually allowed to use them without asking the user first**.

In an automated run (`claude -p`), there is no user sitting at the keyboard. If Claude encounters a tool call or file access that is not pre-authorized in `settings.json`, it will pause and wait for input — which never comes — causing the script to hang or fail.

### Permissions that MUST be configured

#### 1. MCP tool access

Add the MCP server names to the `allow` list so Claude can call their tools without prompting:

```json
{
  "permissions": {
    "allow": [
      "mcp__crashpoint-ios__*",
      "mcp__apptics-mcp__*"
    ]
  }
}
```

Replace `apptics-mcp` with the actual value of `APPTICS_MCP_NAME` from your config. If you are not using Apptics, omit that line.

#### 2. File read access

Phase 2 reads your source code files to perform root cause analysis. These paths must be explicitly allowed:

```json
{
  "permissions": {
    "allow": [
      "file_read:/path/to/master/**",
      "file_read:/path/to/dev/**",
      "file_read:/path/to/ParentHolderFolder/**"
    ]
  }
}
```

Use the same paths as `MASTER_BRANCH_PATH`, `DEV_BRANCH_PATH`, and `CRASH_ANALYSIS_PARENT` from your config.

#### 3. File write access

The pipeline writes fix plans and analysis reports into `ParentHolderFolder`:

```json
{
  "permissions": {
    "allow": [
      "file_write:/path/to/ParentHolderFolder/**"
    ]
  }
}
```

### Complete example `~/.claude/settings.json`

```json
{
  "permissions": {
    "allow": [
      "mcp__crashpoint-ios__*",
      "mcp__apptics-mcp__*",
      "file_read:/Users/yourname/Projects/MyApp-master/**",
      "file_read:/Users/yourname/Projects/MyApp-dev/**",
      "file_read:/Users/yourname/CrashAnalysis/MyApp/**",
      "file_write:/Users/yourname/CrashAnalysis/MyApp/**"
    ]
  }
}
```

### After editing `settings.json`

If you have any Claude CLI sessions running (`claude` in terminal), restart them for the new permissions to take effect. Processes started after the file is saved will pick up the new settings automatically.

---

## 8. Verifying the Full Pipeline Flow

Use this checklist to confirm the end-to-end setup is working correctly. Work through it in order.

1. **Folder tree created** — Run `setup_folders` and confirm the directories exist:
   ```bash
   ls /path/to/ParentHolderFolder/
   # Expect: MainCrashLogsFolder/ SymbolicatedCrashLogsFolder/ AnalyzedReportsFolder/
   #         StateMaintenance/ Automation/ .mcp.json crashpoint.config.json
   ```

2. **`.mcp.json` is present** — Verify the auto-generated MCP config exists:
   ```bash
   cat /path/to/ParentHolderFolder/.mcp.json
   # Expect: JSON with "crashpoint-ios" server entry and CRASH_ANALYSIS_PARENT env var
   ```

3. **Shell script path is correct** — Check that the placeholder was substituted:
   ```bash
   head -15 /path/to/ParentHolderFolder/Automation/run_crash_pipeline.sh
   # The PARENT_HOLDER_FOLDER line should show your real path, not <REPLACE_WITH_...>
   ```

4. **launchd plist exists and is correct** — Inspect it:
   ```bash
   cat ~/Library/LaunchAgents/com.crashpipeline.daily_mcp.plist
   # Confirm the ProgramArguments points to your run_crash_pipeline.sh
   # Confirm the Hour/Minute match your SCHEDULED_RUN_TIME
   ```

5. **Place a test crash file** — Copy or move a `.crash` file into:
   ```
   MainCrashLogsFolder/OtherCrashLogs/
   ```

6. **Run the CLI pipeline** — Test the symbolication and analysis steps directly:
   ```bash
   CRASH_ANALYSIS_PARENT=/path/to/ParentHolderFolder node dist/cli.js pipeline
   ```

7. **Verify symbolicated output** — After step 6:
   ```bash
   ls /path/to/ParentHolderFolder/SymbolicatedCrashLogsFolder/
   # Expect: symbolicated .crash files
   ```

8. **Verify analysis reports** — After step 6:
   ```bash
   ls /path/to/ParentHolderFolder/AnalyzedReportsFolder/
   # Expect: timestamped .json and .csv files plus latest.json and latest.csv
   ```

9. **Run the bash script manually** — Test the full automated flow:
   ```bash
   bash /path/to/ParentHolderFolder/Automation/run_crash_pipeline.sh
   ```
   Then check the log:
   ```bash
   cat /path/to/ParentHolderFolder/Automation/ScheduledRunLogs/pipeline_*.log
   ```

10. **Confirm Cliq notification** — If `ZOHO_CLIQ_WEBHOOK_URL` is set, check the configured Cliq channel for a crash report message.

---

## 9. Common Issues & Troubleshooting

### "CRASH_ANALYSIS_PARENT is required"

The environment variable is not set. Check that:
- The MCP client config (`claude_desktop_config.json` or `.cursor/mcp.json`) has `"CRASH_ANALYSIS_PARENT"` in its `env` block.
- The value is an absolute path to a folder that exists.
- There are no trailing slashes or typos in the path.

### "symbolicatecrash not found"

Xcode CLI tools are not installed or the Xcode path is not set correctly.

```bash
xcode-select --install
# After install:
xcode-select -p
# Should print something like /Applications/Xcode.app/Contents/Developer
```

If you have multiple Xcode installations, set the active one:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

### "dSYM UUID mismatch"

The `.dSYM` file was built from a different binary than the one that produced the crash. Symbolication requires an exact UUID match. Use the `verify_dsym` tool to diagnose:

```bash
CRASH_ANALYSIS_PARENT=/path/to/ParentHolderFolder node dist/cli.js verify-dsym
```

The output shows which UUIDs appear in your crash files and whether they match the `.dSYM`. You need to find the `.dSYM` that was archived at the same time as the crashing build.

### "jq is required but not found"

Install jq:

```bash
brew install jq
```

If `brew` is not installed, visit [brew.sh](https://brew.sh) and install Homebrew first.

### Claude CLI hangs during automation

This is almost always a missing permissions issue in `~/.claude/settings.json`. When Claude tries to use a tool or read a file that is not pre-authorized, it pauses and waits for interactive confirmation — which never arrives in a non-interactive (`-p`) run.

Fix: Add the appropriate entries to the `allow` list in `~/.claude/settings.json` as described in Section 7, then re-run the script.

### Phase 1 fails, Phase 2 skipped

Check the log file for the specific error:

```bash
cat /path/to/ParentHolderFolder/Automation/ScheduledRunLogs/pipeline_*.log
```

Common causes:
- Apptics API credentials are wrong or expired (`APPTICS_PORTAL_ID`, `APPTICS_PROJECT_ID`).
- Network is unavailable (check VPN, firewall, or proxy settings).
- A required config value is missing or misspelled in `crashpoint.config.json`.

### launchd job doesn't run

Work through this checklist:

1. Confirm the plist is loaded:
   ```bash
   launchctl list | grep crashpipeline
   ```
   If nothing appears, load it: `launchctl load ~/Library/LaunchAgents/com.crashpipeline.daily_mcp.plist`

2. Check the launchd output logs:
   ```bash
   cat /tmp/crashpipeline_stdout.log
   cat /tmp/crashpipeline_stderr.log
   ```

3. Check whether the Mac was awake at the scheduled time. If it was asleep, the job will run at next wake. See Section 6 for how to configure a wake event.

4. Confirm the plist has the correct script path:
   ```bash
   cat ~/Library/LaunchAgents/com.crashpipeline.daily_mcp.plist
   ```

### "Config file contains invalid JSON"

There is a syntax error in `crashpoint.config.json`. Validate it with:

```bash
node -e "JSON.parse(require('fs').readFileSync('/path/to/crashpoint.config.json', 'utf8'))" \
  && echo "JSON is valid"
```

Common mistakes: trailing commas after the last key-value pair, unescaped backslashes in Windows paths, or copy-paste errors introducing curly quotes instead of straight quotes.

---

## 10. Quick Reference: Key File Locations

| File | Location | Purpose |
|---|---|---|
| Config file | `<ParentHolderFolder>/crashpoint.config.json` | All user configuration — single source of truth |
| MCP client config | `<ParentHolderFolder>/.mcp.json` | Auto-generated; used by Claude CLI for automation |
| Shell script | `<ParentHolderFolder>/Automation/run_crash_pipeline.sh` | Main automation entry point |
| Phase 1 prompt | `<ParentHolderFolder>/Automation/daily_crash_pipeline_prompt_phase1.md` | Prompt for data collection phase (with frontmatter) |
| Phase 2 prompt | `<ParentHolderFolder>/Automation/daily_crash_pipeline_prompt_phase2.md` | Prompt for crash analysis phase (with frontmatter) |
| Run logs | `<ParentHolderFolder>/Automation/ScheduledRunLogs/` | Timestamped log file per pipeline run |
| Fix plans | `<ParentHolderFolder>/Automation/FixPlans/LatestFixPlan.md` | Auto-generated crash fix analysis document |
| launchd plist | `~/Library/LaunchAgents/com.crashpipeline.daily_mcp.plist` | macOS scheduled job definition |
| Claude settings | `~/.claude/settings.json` | Claude CLI permissions (pre-authorize tools & file paths) |
| launchd stdout | `/tmp/crashpipeline_stdout.log` | Script output captured by launchd |
| launchd stderr | `/tmp/crashpipeline_stderr.log` | Script errors captured by launchd |
| Processed manifest | `<ParentHolderFolder>/StateMaintenance/processed_manifest.json` | Tracks already-processed crash files by UUID |
| Fix status | `<ParentHolderFolder>/StateMaintenance/fix_status.json` | Local fix tracking database |
