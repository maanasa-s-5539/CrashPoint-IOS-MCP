---
model: claude-opus-4-6
effort: high
---

You are running Phase 2 of the automated daily crash analysis pipeline: Deep Crash Cause Analysis.

## Rules
- **Do NOT create any files** in the working directory or ParentHolderFolder — no temporary files, no `.jq` files, no `.sh` scripts, no helper files of any kind. Only use the MCP tools provided; do not write files directly to disk unless an MCP tool does it for you.

## Step 6: Analyze Fix Status and Create Fix Plan

Read the crash analysis report from the latest report file. Find the latest report file in the AnalyzedReportsFolder/ directory. Look for `latest.json` first (a stable pointer to the most recent report). If that doesn't exist, look for files matching `jsonReport_*.json` and pick the most recently modified one. As a last fallback, check for `report.json` in the ParentHolderFolder. Read `crashpoint.config.json` from the working directory for MASTER_BRANCH_PATH and DEV_BRANCH_PATH. DON'T look for any report file elsewhere if not found in the AnalyzedReportsFolder/ directory.

If the report shows crash groups were found (crashGroups > 0):

1. Read the crash analysis report from the reportPath in the pipeline result. For each crash group, extract the **exception type**, **signature**, and **top frames** (these are symbolicated with full file/line references).

2. For each crash group, examine the source file(s) referenced in the top frames:
   - Read the relevant source files from the **Master/Live branch** path (configured as MASTER_BRANCH_PATH in crashpoint.config.json) to understand the crash-causing code.
   - Read the same source files from the **Development branch** path (configured as DEV_BRANCH_PATH in crashpoint.config.json) to check whether the crash site has been modified or fixed.

**IMPORTANT:** The Master branch path and Development branch path are explicitly included in the file_read allow_list in settings.json. You HAVE read permission to these directories even though they are outside the working directory. Do NOT skip source file reading — always attempt to read the files before concluding they are inaccessible.

3. Check if a 'LatestFixPlan.md' exists in the Automation/FixPlans/ folder.

4. If this exists, verify if the existing crash signature has already been analyzed, if yes, increase the crash occurrence count only.

5. If the file doesn't exist, create a plan 'LatestFixPlan.md' in the Automation/FixPlans/ folder.

6. For each crash, determine:
   - **Possible Cause**: Based on the exception type, stack trace, and the source code at that location in the Master branch, describe the likely root cause.
   - **Fix Status**: Compare the Master and Dev branch versions of the file. If the code at or around the crash site has been changed in Dev, describe what was changed and whether it appears to address the crash.
   - **Suggested Fix**: If no fix exists in Dev, suggest a concrete fix approach.

7. Write the results to `Automation/FixPlans/LatestFixPlan.md` inside the ParentHolderFolder with the following structure:

# Crash Fix Plan — {date}

## Summary
- Total crash groups analyzed: {count}
- Fixed in Development: {count}
- Not yet fixed: {count}

## Crash Groups

### 1. {Exception Type} — {Signature snippet}
- **Occurrences:** {count}
- **Top Frames:** {list the top symbolicated frames}
- **Possible Cause:** {analysis of why this crash occurs}
- **Status in Development Branch:** Fixed / Not Fixed
- **Changes in Dev:** {description of relevant changes, or "No changes detected"}
- **Suggested Fix:** {if not fixed, describe the recommended approach}

### 2. ...

After completing all analysis, output a complete summary.
