#!/usr/bin/env bash
# scripts/setup_symlinks.sh
# Creates the ParentHolderFolder structure and optional branch/dSYM/app symlinks.
# Usage: CRASH_ANALYSIS_PARENT=/path/to/ParentHolderFolder \
#        MASTER_BRANCH_PATH=/path/to/master \
#        DEV_BRANCH_PATH=/path/to/dev \
#        DSYM_PATH=/path/to/MyApp.dSYM \
#        APP_PATH=/path/to/MyApp.app \
#        bash scripts/setup_symlinks.sh

set -euo pipefail

PARENT="${CRASH_ANALYSIS_PARENT:?CRASH_ANALYSIS_PARENT env var must be set}"

echo "Setting up folder structure under: $PARENT"

mkdir -p "$PARENT/BasicCrashLogsFolder"
mkdir -p "$PARENT/SymbolicatedCrashLogsFolder"

echo "  ✅ BasicCrashLogsFolder"
echo "  ✅ SymbolicatedCrashLogsFolder"

# CurrentMasterLiveBranch symlink
if [[ -n "${MASTER_BRANCH_PATH:-}" ]]; then
  LINK="$PARENT/CurrentMasterLiveBranch"
  if [[ -L "$LINK" ]] || [[ -e "$LINK" ]]; then
    rm -f "$LINK"
  fi
  ln -s "$MASTER_BRANCH_PATH" "$LINK"
  echo "  ✅ CurrentMasterLiveBranch -> $MASTER_BRANCH_PATH"
  if [[ ! -e "$MASTER_BRANCH_PATH" ]]; then
    echo "  ⚠️  Warning: MASTER_BRANCH_PATH target does not exist: $MASTER_BRANCH_PATH"
  fi
else
  echo "  ℹ️  MASTER_BRANCH_PATH not set — skipping CurrentMasterLiveBranch symlink"
fi

# CurrentDevelopmentBranch symlink
if [[ -n "${DEV_BRANCH_PATH:-}" ]]; then
  LINK="$PARENT/CurrentDevelopmentBranch"
  if [[ -L "$LINK" ]] || [[ -e "$LINK" ]]; then
    rm -f "$LINK"
  fi
  ln -s "$DEV_BRANCH_PATH" "$LINK"
  echo "  ✅ CurrentDevelopmentBranch -> $DEV_BRANCH_PATH"
  if [[ ! -e "$DEV_BRANCH_PATH" ]]; then
    echo "  ⚠️  Warning: DEV_BRANCH_PATH target does not exist: $DEV_BRANCH_PATH"
  fi
else
  echo "  ℹ️  DEV_BRANCH_PATH not set — skipping CurrentDevelopmentBranch symlink"
fi

# dSYM_File symlink
if [[ -n "${DSYM_PATH:-}" ]]; then
  LINK="$PARENT/dSYM_File"
  if [[ -L "$LINK" ]] || [[ -e "$LINK" ]]; then
    rm -f "$LINK"
  fi
  ln -s "$DSYM_PATH" "$LINK"
  echo "  ✅ dSYM_File -> $DSYM_PATH"
  if [[ ! -e "$DSYM_PATH" ]]; then
    echo "  ⚠️  Warning: DSYM_PATH target does not exist: $DSYM_PATH"
  fi
else
  echo "  ℹ️  DSYM_PATH not set — skipping dSYM_File symlink"
fi

# app_File symlink
if [[ -n "${APP_PATH:-}" ]]; then
  LINK="$PARENT/app_File"
  if [[ -L "$LINK" ]] || [[ -e "$LINK" ]]; then
    rm -f "$LINK"
  fi
  ln -s "$APP_PATH" "$LINK"
  echo "  ✅ app_File -> $APP_PATH"
  if [[ ! -e "$APP_PATH" ]]; then
    echo "  ⚠️  Warning: APP_PATH target does not exist: $APP_PATH"
  fi
else
  echo "  ℹ️  APP_PATH not set — skipping app_File symlink"
fi

echo ""
echo "Done. Folder structure:"
ls -la "$PARENT"
