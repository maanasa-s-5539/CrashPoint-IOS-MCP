---
model: claude-sonnet-4-6
effort: medium
---

You are running an automated daily crash analysis pipeline (Phase 1: Data Collection & Reporting). Execute these steps in order, stopping if any step fails:

## Rules
- **Do NOT create any files** in the working directory or ParentHolderFolder — no temporary files, no `.jq` files, no `.sh` scripts, no helper files of any kind. Only use the MCP tools provided; do not write files directly to disk unless an MCP tool does it for you.

## Step 1 & 2: Download Crashes from Apptics and Save Locally

Use the {{APPTICS_MCP_NAME}} MCP server to fetch crash data, and the crashpoint-ios MCP server to download and save it.

1. Read `crashpoint.config.json` from the working directory to get CRASH_DATE_OFFSET, CRASH_NUM_DAYS, CRASH_VERSIONS, APPTICS_PORTAL_ID, and APPTICS_PROJECT_ID.
2. Compute the date range using values from the config: endDate = today minus CRASH_DATE_OFFSET days (default 4 if not set), startDate = endDate minus CRASH_NUM_DAYS + 1 (default 1 if not set). Format dates as DD-MM-YYYY for the Apptics API.
3. Call `ZohoApptics_getCrashList` with:
   - headers: zsoid = APPTICS_PORTAL_ID, projectid = APPTICS_PROJECT_ID
   - query_params: startdate, enddate (DD-MM-YYYY), platform = "iOS", mode = 1, with app version = CRASH_VERSIONS.
4. Call `fetch_and_save_apptics_crashes` from the crashpoint-ios MCP server ONCE, passing:
   - crashes: the full crash list array from step 3
   - appticsBaseUrl: the base URL of the Apptics MCP server (from config or default "https://apptics.zoho.com")
   - appticsPortalId: APPTICS_PORTAL_ID from config
   - appticsProjectId: APPTICS_PROJECT_ID from config
   - startDate, endDate: the computed date range in DD-MM-YYYY format
   - concurrency: 10
   - clearExisting: true
   - accessToken: the OAuth access token if available from the Apptics MCP server authentication
   This fetches all crash details in parallel (up to 10 at a time) and writes each .crash file sequentially on the server side. No content truncation is possible since writing happens entirely server-side.
5. Verify the result: check that `saved` equals the total number of crashes from step 3. If `failed` > 0, log a warning but continue.

## Step 3: Run Local Pipeline (Export + Symbolicate + Analyze)
Use the crashpoint-ios MCP server. Call `run_full_pipeline` with notifyCliq=true and reportToProjects=true, and pass `expectedCrashCount` set to the total number of crash entries returned by `getCrashList` (so the pipeline can warn if any crash files were lost during save). The pipeline will export local crash logs (including Xcode crashes), symbolicate them, and analyze all crash files including the Apptics crashes saved in the previous step.

## Step 4: Notify Cliq
If the pipeline result shows crash groups were found (check analyze.crashGroups > 0), use the crashpoint-ios MCP server to call the `notify_cliq` tool with the report path from the pipeline result. Do NOT use curl, Bash, or any other method — only the `notify_cliq` MCP tool. The tool handles the HTTP request to Zoho Cliq internally.

## Step 5: Create/Update Bugs in Zoho Projects
If the pipeline result has nextSteps.reportToProjects=true, use the crashpoint-ios MCP server to call `prepare_project_bugs` to get structured bug data. Then use the {{APPTICS_MCP_NAME}} MCP server's Zoho Projects tools to create or update bugs:
- If an issue with the same crash signature and app version number does not exist already, create a new issue, setting the App Version and Number of Occurrences field values.
- If an issue with the same crash signature exists already, update the existing crash's number of occurrences. Take the existing value in the number of occurrences field, add the new number of occurrences reported, and update the field with the summed value.

After completing all steps, output a summary of what was processed including the reportPath from the pipeline result. Phase 2 (crash cause analysis) will continue in a separate invocation.
