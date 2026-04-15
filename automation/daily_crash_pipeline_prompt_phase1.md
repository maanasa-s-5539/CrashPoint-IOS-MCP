---
model: claude-sonnet-4-6
effort: medium
---

You are running an automated daily crash analysis pipeline (Phase 1: Data Collection & Reporting). Execute these steps in order, stopping if any step fails:

## Rules
- **Do NOT create any files** in the working directory or ParentHolderFolder — no temporary files, no `.jq` files, no `.sh` scripts, no helper files of any kind. Only use the MCP tools provided; do not write files directly to disk unless an MCP tool does it for you.

## Step 1 & 2: Download Crashes from Apptics and Save Locally

> ⚠️ **WARNING — READ BEFORE PROCEEDING:**
> **NEVER call `save_apptics_crashes` with crash entries directly from `getCrashList`.**
> The crash list only contains metadata (Exception, CrashCount, AppVersion, etc.) but does **NOT** include the `Message` field with the full stack trace.
> You **MUST** first call `getCrashSummaryWithUniqueMessageId` for each individual crash to retrieve the `Message` field, then save.
> If you call `save_apptics_crashes` with crashes that lack a `Message` field, the tool will **reject** the call and return an error.
> The `clearExisting: true` call in step 4 must use an **empty array `[]`** — it is ONLY for clearing the directory. NEVER use it to save crash list data.

Use the {{APPTICS_MCP_NAME}} MCP server to fetch crash data, and the crashpoint-ios MCP server to save it.

1. Read `crashpoint.config.json` from the working directory to get CRASH_DATE_OFFSET, CRASH_NUM_DAYS, CRASH_VERSIONS, APPTICS_PORTAL_ID, and APPTICS_PROJECT_ID.
2. Compute the date range using values from the config: endDate = today minus CRASH_DATE_OFFSET days (default 4 if not set), startDate = endDate minus CRASH_NUM_DAYS + 1 (default 1 if not set). Format dates as DD-MM-YYYY for the Apptics API.
3. Call `ZohoApptics_getCrashList` with:
   - headers: zsoid = APPTICS_PORTAL_ID, projectid = APPTICS_PROJECT_ID
   - query_params: startdate, enddate (DD-MM-YYYY), platform = "iOS", mode = 1, with app version = CRASH_VERSIONS.
4. Clear existing Apptics crash files by calling `save_apptics_crashes` on the crashpoint-ios MCP server with `crashes` set to an empty array `[]` and `clearExisting: true`. This ensures a clean slate. **Do NOT pass any crash data here** — the empty array is intentional.
5. For each crash entry from step 3, process ONE AT A TIME in sequence:
   a. **[MANDATORY — do NOT skip]** Call `ZohoApptics_getCrashSummaryWithUniqueMessageId` via the {{APPTICS_MCP_NAME}} MCP server for that single crash's UniqueMessageID to retrieve the full crash detail including the `Message` field (complete crash report text with stack trace). **Step 5a is MANDATORY before 5b — you cannot skip fetching the crash detail.**
   b. Immediately call `save_apptics_crashes` on the crashpoint-ios MCP server with:
      - `crashes`: a single-element array containing the crash entry enriched with the `Message` field from step (a). Pass the **complete, untruncated** Message — do not summarize or shorten it.
      - `clearExisting`: `false` (the directory was already cleared in step 4)
   c. After confirming the file was saved, move to the next crash. Do NOT accumulate multiple crash Messages — each crash is fetched, saved to disk server-side, and discarded before processing the next one.
   d. **VALIDATION:** Before calling `save_apptics_crashes`, verify that the crash object you are passing contains a non-empty `Message` field. If it does not, you have a bug — go back to step 5a and fetch the crash detail. The tool will reject saves without `Message` when `clearExisting` is false.
   This one-at-a-time pattern keeps token usage constant regardless of crash count — only one crash report is in context at any time. Writing happens server-side via `fs.writeFileSync`, so no content truncation is possible.
6. After all crashes are processed, verify: the total number of saved crashes should equal the total from step 3. If any saves failed, log a warning but continue.

## Step 3: Run Local Pipeline (Export + Symbolicate + Analyze)
Use the crashpoint-ios MCP server. Call `run_full_pipeline` with notifyCliq=true and reportToProjects=true, and pass `expectedCrashCount` set to the total number of crash entries returned by `getCrashList` (so the pipeline can warn if any crash files were lost during save). The pipeline will export local crash logs (including Xcode crashes), symbolicate them, and analyze all crash files including the Apptics crashes saved in the previous step.

## Step 4: Notify Cliq
If the pipeline result shows crash groups were found (check analyze.crashGroups > 0), use the crashpoint-ios MCP server to call the `notify_cliq` tool with the report path from the pipeline result. Do NOT use curl, Bash, or any other method — only the `notify_cliq` MCP tool. The tool handles the HTTP request to Zoho Cliq internally.

## Step 5: Create/Update Bugs in Zoho Projects
If the pipeline result has nextSteps.reportToProjects=true, use the crashpoint-ios MCP server to call `prepare_project_bugs` to get structured bug data. Then use the {{APPTICS_MCP_NAME}} MCP server's Zoho Projects tools to create or update bugs:
- If an issue with the same crash signature and app version number does not exist already, create a new issue, setting the App Version and Number of Occurrences field values.
- If an issue with the same crash signature exists already, update the existing crash's number of occurrences. Take the existing value in the number of occurrences field, add the new number of occurrences from this run, and set the total as the new value.

After completing all steps, output a summary of what was processed including the reportPath from the pipeline result. Phase 2 (crash cause analysis) will continue in a separate invocation.
