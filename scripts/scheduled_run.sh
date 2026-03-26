#!/usr/bin/env bash
# scripts/scheduled_run.sh
# Runs the full crash analysis pipeline and sends a Cliq notification.
# Intended to be run via cron or launchd.
#
# Cron example (daily at 9am):
#   0 9 * * * /path/to/scripts/scheduled_run.sh >> /path/to/crashpoint.log 2>&1
#
# launchd example: see README.md for a sample plist.
#
# Required env vars (set in .env or pass directly):
#   CRASH_ANALYSIS_PARENT, DSYM_PATH, APP_PATH, ZOHO_CLIQ_WEBHOOK_URL

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if present
if [[ -f "$PROJECT_DIR/.env" ]]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

: "${CRASH_ANALYSIS_PARENT:?CRASH_ANALYSIS_PARENT env var must be set}"

REPORT_FILE="$CRASH_ANALYSIS_PARENT/report_$(date +%s)000.json"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting scheduled crash analysis..."

# Step 1: Export
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Exporting crash logs..."
node "$PROJECT_DIR/dist/cli.js" export

# Step 2: Batch symbolicate
if [[ -n "${DSYM_PATH:-}" ]]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Symbolicating crashes..."
  node "$PROJECT_DIR/dist/cli.js" batch
else
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] DSYM_PATH not set — skipping symbolication"
fi

# Step 3: Analyze
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Analyzing crashes..."
node "$PROJECT_DIR/dist/cli.js" analyze -o "$REPORT_FILE"

# Step 4: Notify Cliq
if [[ -n "${ZOHO_CLIQ_WEBHOOK_URL:-}" ]]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Sending Cliq notification..."
  node "$PROJECT_DIR/dist/cli.js" notify --report "$REPORT_FILE"
else
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] No Cliq webhook configured — skipping notification"
fi

# Step 4b: Send unfixed-only report to Cliq
if [[ -n "${ZOHO_CLIQ_WEBHOOK_URL:-}" ]]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Sending unfixed crashes report to Zoho Cliq..."
  node "$PROJECT_DIR/dist/cli.js" notify-unfixed
else
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] No Cliq webhook configured — skipping unfixed notification"
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Done. Report saved to: $REPORT_FILE"
