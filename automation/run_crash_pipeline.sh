#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/ScheduledRunLogs"
mkdir -p "$LOG_DIR"

PARENT_HOLDER_FOLDER="<REPLACE_WITH_PATH_TO_PARENT_HOLDER_FOLDER>"
CONFIG_JSON="$PARENT_HOLDER_FOLDER/crashpoint.config.json"

if [ ! -f "$CONFIG_JSON" ]; then
  echo "ERROR: Config file not found at $CONFIG_JSON"; exit 1
fi
if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$CONFIG_JSON" 2>/dev/null; then
  echo "ERROR: Config file contains invalid JSON"; exit 1
fi

# ─── AUTO-SETUP ────────────────────────────────────────────────────────────────
# Mirror the same check used in run_full_pipeline / run_basic_pipeline MCP tools:
# if StateMaintenance/ or Automation/ are missing, bootstrap via the CLI setup command.
CRASHPOINT_PACKAGE_ROOT="<REPLACE_WITH_CRASHPOINT_PACKAGE_ROOT>"
STATE_DIR="$PARENT_HOLDER_FOLDER/StateMaintenance"
AUTO_DIR="$PARENT_HOLDER_FOLDER/Automation"
if [ ! -d "$STATE_DIR" ] || [ ! -d "$AUTO_DIR" ]; then
  echo "Auto-setup: workspace not fully initialized — running setup..."
  if CRASH_ANALYSIS_PARENT="$PARENT_HOLDER_FOLDER" \
      node "$CRASHPOINT_PACKAGE_ROOT/dist/cli.js" setup; then
    echo "Auto-setup complete."
  else
    echo "ERROR: Auto-setup failed — run 'node $CRASHPOINT_PACKAGE_ROOT/dist/cli.js setup' manually to diagnose."; exit 1
  fi
fi

# Read config values
APP_DISPLAY_NAME=$(node -e "console.log(require(process.argv[1]).APP_DISPLAY_NAME || '')" "$CONFIG_JSON")
APPTICS_MCP_NAME=$(node -e "console.log(require(process.argv[1]).APPTICS_MCP_NAME || '')" "$CONFIG_JSON")
MASTER_BRANCH_PATH=$(node -e "console.log(require(process.argv[1]).MASTER_BRANCH_PATH || '')" "$CONFIG_JSON")
DEV_BRANCH_PATH=$(node -e "console.log(require(process.argv[1]).DEV_BRANCH_PATH || '')" "$CONFIG_JSON")

# Validate required config values
if [ -z "$APP_DISPLAY_NAME" ]; then
  echo "ERROR: APP_DISPLAY_NAME not set in $CONFIG_JSON"; exit 1
fi

CLAUDE_PATH=$(node -e "console.log(require(process.argv[1]).CLAUDE_CLI_PATH || '')" "$CONFIG_JSON")
if [ -z "$CLAUDE_PATH" ]; then
  echo "ERROR: CLAUDE_CLI_PATH not set in $CONFIG_JSON"; exit 1
fi
if [ ! -x "$CLAUDE_PATH" ]; then
  echo "ERROR: Claude CLI not found or not executable at $CLAUDE_PATH"; exit 1
fi
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not found in PATH"; exit 1
fi

# ─── FRONTMATTER HELPERS ───────────────────────────────────────────────────
parse_frontmatter() {
  local file="$1"
  local key="$2"
  sed -n '/^---$/,/^---$/p' "$file" | grep "^${key}:" | sed "s/^${key}:[[:space:]]*//"
}

strip_frontmatter() {
  local file="$1"
  sed -e '1{/^---$/!q;}' -e '1,/^---$/d' "$file"
}

# Clear latest report pointers
ANALYZED_DIR="$PARENT_HOLDER_FOLDER/AnalyzedReportsFolder"
if [ -f "$ANALYZED_DIR/latest.json" ]; then rm -f "$ANALYZED_DIR/latest.json"; fi
if [ -f "$ANALYZED_DIR/latest.csv" ]; then rm -f "$ANALYZED_DIR/latest.csv"; fi
mkdir -p "$ANALYZED_DIR"

# ─── PROMPT TEMPLATES ──────────────────────────────────────────────────────
PROMPT_FILE_PHASE1="$SCRIPT_DIR/daily_crash_pipeline_prompt_phase1.md"
PROMPT_FILE_PHASE2="$SCRIPT_DIR/daily_crash_pipeline_prompt_phase2.md"

if [ ! -f "$PROMPT_FILE_PHASE1" ]; then
  echo "ERROR: Phase 1 prompt template not found at $PROMPT_FILE_PHASE1"; exit 1
fi
if [ ! -f "$PROMPT_FILE_PHASE2" ]; then
  echo "ERROR: Phase 2 prompt template not found at $PROMPT_FILE_PHASE2"; exit 1
fi

# Parse frontmatter from both prompt files
PHASE1_MODEL=$(parse_frontmatter "$PROMPT_FILE_PHASE1" "model")
PHASE1_EFFORT=$(parse_frontmatter "$PROMPT_FILE_PHASE1" "effort")
PHASE2_MODEL=$(parse_frontmatter "$PROMPT_FILE_PHASE2" "model")
PHASE2_EFFORT=$(parse_frontmatter "$PROMPT_FILE_PHASE2" "effort")

# Validate model values were extracted
if [ -z "$PHASE1_MODEL" ]; then
  echo "ERROR: No 'model' found in Phase 1 prompt frontmatter"; exit 1
fi
if [ -z "$PHASE2_MODEL" ]; then
  echo "ERROR: No 'model' found in Phase 2 prompt frontmatter"; exit 1
fi

# Strip frontmatter and get prompt body
PROMPT_BODY_PHASE1=$(strip_frontmatter "$PROMPT_FILE_PHASE1")
PROMPT_BODY_PHASE2=$(strip_frontmatter "$PROMPT_FILE_PHASE2")

# Substitute placeholders in Phase 1 prompt body
if [ -n "$APPTICS_MCP_NAME" ]; then
  PROMPT_PHASE1=$(echo "$PROMPT_BODY_PHASE1" | sed "s|{{APPTICS_MCP_NAME}}|${APPTICS_MCP_NAME}|g")
else
  PROMPT_PHASE1=$(echo "$PROMPT_BODY_PHASE1" | sed '/{{APPTICS_MCP_NAME}}/d')
fi

# Phase 2 has no placeholders
PROMPT_PHASE2="$PROMPT_BODY_PHASE2"

# Build allowed tools dynamically — everything is now in crashpoint-ios
ALLOWED_TOOLS="mcp__crashpoint-ios__*"
if [ -n "$APPTICS_MCP_NAME" ]; then
  ALLOWED_TOOLS="${ALLOWED_TOOLS},mcp__${APPTICS_MCP_NAME}__*"
fi

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="$LOG_DIR/pipeline_${TIMESTAMP}.log"

{
  echo "=== Crash Pipeline Run: $TIMESTAMP ==="
  echo "App:           ${APP_DISPLAY_NAME}"
  echo "Phase 1:       model=${PHASE1_MODEL} effort=${PHASE1_EFFORT}"
  echo "Phase 2:       model=${PHASE2_MODEL} effort=${PHASE2_EFFORT}"
  if [ -n "$APPTICS_MCP_NAME" ]; then
    echo "Apptics MCP:   ${APPTICS_MCP_NAME} (used for Zoho Projects bug tools)"
  fi
  echo "Allowed Tools: ${ALLOWED_TOOLS}"
  if [ -n "$MASTER_BRANCH_PATH" ]; then
    echo "Master Path:   ${MASTER_BRANCH_PATH} (ensure read access in Claude settings)"
  fi
  if [ -n "$DEV_BRANCH_PATH" ]; then
    echo "Dev Path:      ${DEV_BRANCH_PATH} (ensure read access in Claude settings)"
  fi
  echo "---"
} | tee "$LOG_FILE"

cd "$PARENT_HOLDER_FOLDER"

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 1: Steps 1–5 (download, save, pipeline, cliq, bugs)
# ═══════════════════════════════════════════════════════════════════════════
echo "" | tee -a "$LOG_FILE"
echo "=== PHASE 1: Data Collection & Reporting (${PHASE1_MODEL}, effort=${PHASE1_EFFORT}) ===" | tee -a "$LOG_FILE"

set +e
"$CLAUDE_PATH" -p "$PROMPT_PHASE1" \
  --model "$PHASE1_MODEL" \
  --allowedTools "$ALLOWED_TOOLS" \
  --output-format stream-json \
  --verbose \
  --max-turns 200 \
  2>>"$LOG_FILE" | jq --unbuffered -R -r '
    try (fromjson | select(.type == "assistant")
    | .message.content[]
    | select(.type == "text")
    | .text) // empty
  ' | tee -a "$LOG_FILE"

PIPE_STATUSES=("${PIPESTATUS[@]}")
set -e

# Cleanup: remove any stray .jq or .sh files Claude may have created in ParentHolderFolder
find "$PARENT_HOLDER_FOLDER" -maxdepth 1 -type f \( -name "*.jq" -o -name "*.sh" \) -delete 2>/dev/null || true

PHASE1_EXIT=${PIPE_STATUSES[0]}
JQ_EXIT=${PIPE_STATUSES[1]}

if [ "$JQ_EXIT" -ne 0 ]; then
  echo "WARNING: jq filtering failed in Phase 1 with exit code $JQ_EXIT" | tee -a "$LOG_FILE"
fi

if [ "$PHASE1_EXIT" -ne 0 ]; then
  echo "ERROR: Phase 1 failed with exit code $PHASE1_EXIT — skipping Phase 2" | tee -a "$LOG_FILE"
  exit "$PHASE1_EXIT"
fi

echo "" | tee -a "$LOG_FILE"
echo "=== Phase 1 Complete ===" | tee -a "$LOG_FILE"

# ═══════════════════════════════════════════════════════════════════════════
# PHASE 2: Step 6 (crash cause analysis + FixPlan.md)
# ═══════════════════════════════════════════════════════════════════════════
echo "" | tee -a "$LOG_FILE"
echo "=== PHASE 2: Crash Cause Analysis & Fix Plan (${PHASE2_MODEL}, effort=${PHASE2_EFFORT}) ===" | tee -a "$LOG_FILE"

# NOTE: Read access to MASTER_BRANCH_PATH and DEV_BRANCH_PATH must be configured
# in Claude's settings.json (permissions.allow) — the CLI has no --permission flag.
set +e
"$CLAUDE_PATH" -p "$PROMPT_PHASE2" \
  --model "$PHASE2_MODEL" \
  --allowedTools "$ALLOWED_TOOLS" \
  --output-format stream-json \
  --verbose \
  --max-turns 70 \
  2>>"$LOG_FILE" | jq --unbuffered -R -r '
    try (fromjson | select(.type == "assistant")
    | .message.content[]
    | select(.type == "text")
    | .text) // empty
  ' | tee -a "$LOG_FILE"

PIPE_STATUSES=("${PIPESTATUS[@]}")
set -e

# Cleanup: remove any stray .jq or .sh files Claude may have created in ParentHolderFolder
find "$PARENT_HOLDER_FOLDER" -maxdepth 1 -type f \( -name "*.jq" -o -name "*.sh" \) -delete 2>/dev/null || true

PHASE2_EXIT=${PIPE_STATUSES[0]}
JQ_EXIT=${PIPE_STATUSES[1]}

if [ "$JQ_EXIT" -ne 0 ]; then
  echo "WARNING: jq filtering failed in Phase 2 with exit code $JQ_EXIT" | tee -a "$LOG_FILE"
fi

if [ "$PHASE2_EXIT" -ne 0 ]; then
  echo "ERROR: Phase 2 failed with exit code $PHASE2_EXIT" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "=== Pipeline Complete (Phase 1: ${PHASE1_EXIT}, Phase 2: ${PHASE2_EXIT}) ===" | tee -a "$LOG_FILE"
if [ "$PHASE1_EXIT" -ne 0 ] || [ "$PHASE2_EXIT" -ne 0 ]; then
  FINAL_EXIT=$(( PHASE1_EXIT > PHASE2_EXIT ? PHASE1_EXIT : PHASE2_EXIT ))
  exit "$FINAL_EXIT"
fi
exit 0
