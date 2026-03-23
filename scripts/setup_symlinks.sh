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

echo ""
echo "Done. Folder structure:"
ls -la "$PARENT"
