#!/usr/bin/env bash
# scripts/setup_symlinks.sh
# Creates the ParentHolderFolder structure and optional branch symlinks.
# Usage: CRASH_ANALYSIS_PARENT=/path/to/ParentHolderFolder \
#        MASTER_BRANCH_PATH=/path/to/master \
#        DEV_BRANCH_PATH=/path/to/dev \
#        bash scripts/setup_symlinks.sh

set -euo pipefail

PARENT="${CRASH_ANALYSIS_PARENT:?CRASH_ANALYSIS_PARENT env var must be set}"

echo "Setting up folder structure under: $PARENT"

mkdir -p "$PARENT/BasicCrashLogsFolder"
mkdir -p "$PARENT/SymbolicatedCrashLogsFolder"

echo "  ✅ BasicCrashLogsFolder"
echo "  ✅ SymbolicatedCrashLogsFolder"

# Helper: resolve a path to absolute (uses realpath if target exists, else manual resolution)
resolve_path() {
  local p="$1"
  if [[ -e "$p" ]]; then
    realpath "$p"
  else
    # Target doesn't exist yet — resolve relative to cwd manually
    case "$p" in
      /*) echo "$p" ;;          # already absolute
      *)  echo "$(pwd)/$p" ;;  # prepend cwd
    esac
  fi
}

# CurrentMasterLiveBranch symlink
if [[ -n "${MASTER_BRANCH_PATH:-}" ]]; then
  RESOLVED_MASTER="$(resolve_path "$MASTER_BRANCH_PATH")"
  LINK="$PARENT/CurrentMasterLiveBranch"
  if [[ -L "$LINK" ]] || [[ -e "$LINK" ]]; then
    rm -f "$LINK"
  fi
  ln -s "$RESOLVED_MASTER" "$LINK"
  echo "  ✅ CurrentMasterLiveBranch -> $RESOLVED_MASTER"
  if [[ ! -e "$RESOLVED_MASTER" ]]; then
    echo "  ⚠️  Warning: MASTER_BRANCH_PATH target does not exist: $RESOLVED_MASTER"
  fi
else
  echo "  ℹ️  MASTER_BRANCH_PATH not set — skipping CurrentMasterLiveBranch symlink"
fi

# CurrentDevelopmentBranch symlink
if [[ -n "${DEV_BRANCH_PATH:-}" ]]; then
  RESOLVED_DEV="$(resolve_path "$DEV_BRANCH_PATH")"
  LINK="$PARENT/CurrentDevelopmentBranch"
  if [[ -L "$LINK" ]] || [[ -e "$LINK" ]]; then
    rm -f "$LINK"
  fi
  ln -s "$RESOLVED_DEV" "$LINK"
  echo "  ✅ CurrentDevelopmentBranch -> $RESOLVED_DEV"
  if [[ ! -e "$RESOLVED_DEV" ]]; then
    echo "  ⚠️  Warning: DEV_BRANCH_PATH target does not exist: $RESOLVED_DEV"
  fi
else
  echo "  ℹ️  DEV_BRANCH_PATH not set — skipping CurrentDevelopmentBranch symlink"
fi

# dSYM_File symlink
if [[ -n "${DSYM_PATH:-}" ]]; then
  RESOLVED_DSYM="$(resolve_path "$DSYM_PATH")"
  LINK="$PARENT/dSYM_File"
  if [[ -L "$LINK" ]] || [[ -e "$LINK" ]]; then
    rm -f "$LINK"
  fi
  ln -s "$RESOLVED_DSYM" "$LINK"
  echo "  ✅ dSYM_File -> $RESOLVED_DSYM"
  if [[ ! -e "$RESOLVED_DSYM" ]]; then
    echo "  ⚠️  Warning: DSYM_PATH target does not exist: $RESOLVED_DSYM"
  fi
else
  echo "  ℹ️  DSYM_PATH not set — skipping dSYM_File symlink"
fi

# app_File symlink
if [[ -n "${APP_PATH:-}" ]]; then
  RESOLVED_APP="$(resolve_path "$APP_PATH")"
  LINK="$PARENT/app_File"
  if [[ -L "$LINK" ]] || [[ -e "$LINK" ]]; then
    rm -f "$LINK"
  fi
  ln -s "$RESOLVED_APP" "$LINK"
  echo "  ✅ app_File -> $RESOLVED_APP"
  if [[ ! -e "$RESOLVED_APP" ]]; then
    echo "  ⚠️  Warning: APP_PATH target does not exist: $RESOLVED_APP"
  fi
else
  echo "  ℹ️  APP_PATH not set — skipping app_File symlink"
fi

echo ""
echo "Done. Folder structure:"
ls -la "$PARENT"
