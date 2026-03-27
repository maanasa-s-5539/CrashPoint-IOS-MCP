#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getConfig, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, hasCrashFiles } from "./config.js";
import {
  exportCrashLogs,
} from "./core/crashExporter.js";
import {
  runBatch,
  BatchResult,
} from "./core/symbolicator.js";
import { analyzeDirectory, filterUnfixedGroups } from "./core/crashAnalyzer.js";
import { loadFixStatuses } from "./fixTracker.js";
import { assertPathUnderBase } from "./pathSafety.js";
import { reportToZohoProjectsViaMcp, getFieldIdsFromConfig } from "./integrations/zohoProjectsMcpBridge.js";
import { sendCrashReportToCliq } from "./integrations/cliqNotifier.js";
import { ProcessedManifest } from "./processedManifest.js";

const server = new McpServer({
  name: "crashpoint-ios-integrations",
  version: "1.0.0",
});

// ── Tool 1: notify_cliq ──────────────────────────────────────────────────────
server.registerTool(
  "notify_cliq",
  {
    description:
      "Analyze symbolicated crashes and send the report to Zoho Cliq. By default sends all crash types; set unfixedOnly to send only unfixed crashes. Set notify to false for a dry-run (returns report without sending). Requires ZOHO_CLIQ_WEBHOOK_URL in env.",
    inputSchema: z.object({
      crashDir: z.string().optional().describe("Directory of symbolicated crash files (default: SymbolicatedCrashLogsFolder)"),
      unfixedOnly: z.boolean().optional().describe("When true, only unfixed crash types are included in the report (default: false)"),
      notify: z.boolean().optional().describe("Actually send to Cliq (default: true). Set false for dry-run."),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
      totalCrashTypes: z.number(),
      totalFixed: z.number().optional(),
      totalUnfixed: z.number().optional(),
      reportSent: z.boolean(),
      report: z.any().optional(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const crashDir = input.crashDir ?? getSymbolicatedDir(config);
    if (input.crashDir) assertPathUnderBase(input.crashDir, config.CRASH_ANALYSIS_PARENT);
    const unfixedOnly = input.unfixedOnly ?? false;
    const shouldNotify = input.notify !== false;

    const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
    const fullReport = analyzeDirectory(crashDir, fixStatuses);

    let reportToSend = fullReport;
    let totalFixed: number | undefined;
    let totalUnfixed: number | undefined;

    if (unfixedOnly) {
      const { filtered, totalFixed: tf, totalUnfixed: tu } = filterUnfixedGroups(fullReport);
      reportToSend = filtered;
      totalFixed = tf;
      totalUnfixed = tu;
    }

    if (!shouldNotify) {
      const result = {
        success: true,
        message: unfixedOnly
          ? `Dry-run: ${totalUnfixed} unfixed crash type(s), ${totalFixed} fixed. No notification sent.`
          : `Dry-run: ${reportToSend.unique_crash_types} crash type(s). No notification sent.`,
        totalCrashTypes: reportToSend.unique_crash_types,
        totalFixed,
        totalUnfixed,
        reportSent: false,
        report: reportToSend,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    if (reportToSend.unique_crash_types === 0) {
      const result = {
        success: true,
        message: unfixedOnly ? "No unfixed crashes to report." : "No crashes to report.",
        totalCrashTypes: 0,
        totalFixed,
        totalUnfixed,
        reportSent: false,
        report: reportToSend,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }

    const cliqResult = await sendCrashReportToCliq(reportToSend, config);
    const result = {
      success: cliqResult.success,
      message: cliqResult.message,
      totalCrashTypes: reportToSend.unique_crash_types,
      totalFixed,
      totalUnfixed,
      reportSent: cliqResult.success,
      report: reportToSend,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 2: report_to_zoho_projects ─────────────────────────────────────────
server.registerTool(
  "report_to_zoho_projects",
  {
    description:
      "Analyze symbolicated crashes and create a bug in Zoho Projects for each unique crash group. Before creating, fetches existing bugs via getProjectIssues and compares by title — duplicates are updated (occurrences accumulated from the existing description) instead of re-created. Severity is auto-mapped from exception type and occurrence count. Fix status is read from local tracking. Requires ZOHO_PROJECTS_MCP_URL, ZOHO_PROJECTS_PORTAL_ID, and ZOHO_PROJECTS_PROJECT_ID to be configured.",
    inputSchema: z.object({
      crashDir: z.string().optional().describe("Directory of symbolicated crash files (default: SymbolicatedCrashLogsFolder)"),
      unfixedOnly: z.boolean().optional().describe("Only create bugs for unfixed crashes (default: false)"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
      totalBugsCreated: z.number(),
      totalFailed: z.number(),
      totalSkipped: z.number(),
      bugs: z.array(z.any()),
      missingFieldIds: z.array(z.string()),
    }),
  },
  async (input) => {
    const config = getConfig();

    if (!config.ZOHO_PROJECTS_MCP_URL) {
      throw new Error("ZOHO_PROJECTS_MCP_URL env var is required for report_to_zoho_projects.");
    }
    if (!config.ZOHO_PROJECTS_PORTAL_ID) {
      throw new Error("ZOHO_PROJECTS_PORTAL_ID env var is required for report_to_zoho_projects.");
    }
    if (!config.ZOHO_PROJECTS_PROJECT_ID) {
      throw new Error("ZOHO_PROJECTS_PROJECT_ID env var is required for report_to_zoho_projects.");
    }

    const crashDir = input.crashDir ?? getSymbolicatedDir(config);
    if (input.crashDir) assertPathUnderBase(input.crashDir, config.CRASH_ANALYSIS_PARENT);

    const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);

    let report = analyzeDirectory(crashDir, fixStatuses);

    if (input.unfixedOnly) {
      report = filterUnfixedGroups(report).filtered;
    }

    const fieldIds = getFieldIdsFromConfig(config);
    const result = await reportToZohoProjectsViaMcp(
      report,
      config.ZOHO_PROJECTS_MCP_URL,
      config.ZOHO_PROJECTS_PORTAL_ID,
      config.ZOHO_PROJECTS_PROJECT_ID,
      fieldIds
    );

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Tool 3: notify_with_fullpipeline ─────────────────────────────────────────
server.registerTool(
  "notify_with_fullpipeline",
  {
    description:
      "Run the complete crash analysis pipeline (export → symbolicate → analyze) and send report to Zoho Cliq. Optionally also create/update bugs in Zoho Projects. Cliq notification is always sent by default. Zoho Projects issue creation is an optional add-on — set createZohoProjectIssues to true to enable it. Requires ZOHO_CLIQ_WEBHOOK_URL. Zoho Projects also requires ZOHO_PROJECTS_MCP_URL, ZOHO_PROJECTS_PORTAL_ID, and ZOHO_PROJECTS_PROJECT_ID.",
    inputSchema: z.object({
      versions: z.string().optional().describe("Comma-separated version filter for export"),
      startDate: z.string().optional().describe("ISO date string to filter crashes from (e.g. 2026-03-01)"),
      endDate: z.string().optional().describe("ISO date string to filter crashes until (e.g. 2026-03-20)"),
      unfixedOnly: z.boolean().optional().describe("When true, only unfixed crash types are included in notifications and bug creation (default: false)"),
      includeProcessedCrashes: z.boolean().optional().describe("When true, re-processes crashes that were already exported/symbolicated/analyzed. Default is false."),
      createZohoProjectIssues: z.boolean().optional().describe("When true, also create/update bugs in Zoho Projects for each crash group. Default is false — only Cliq notification is sent."),
    }),
    outputSchema: z.object({
      export_result: z.any(),
      symbolication_result: z.any(),
      analysis_report: z.any(),
      cliq_notification: z.object({
        success: z.boolean(),
        message: z.string(),
      }),
      zoho_projects_result: z.any().optional(),
    }),
  },
  async (input) => {
    const config = getConfig();
    const inputDir = config.CRASH_INPUT_DIR ?? config.CRASH_ANALYSIS_PARENT;
    const basicDir = getXcodeCrashesDir(config);
    const symbolicatedDir = getSymbolicatedDir(config);
    const versions = input.versions?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
    const manifest = input.includeProcessedCrashes ? undefined : new ProcessedManifest(config.CRASH_ANALYSIS_PARENT);

    // Step 1: Export
    const exportResult = exportCrashLogs(inputDir, basicDir, versions, false, false, input.startDate, input.endDate, manifest);

    // Step 2: Symbolicate
    const dsymPath = config.DSYM_PATH;
    let symbolicationResult: object = { skipped: true, reason: "DSYM_PATH not configured" };
    if (dsymPath) {
      const appticsDir = getAppticsCrashesDir(config);
      const otherDir = getOtherCrashesDir(config);
      const anyFiles = hasCrashFiles(basicDir) || hasCrashFiles(appticsDir) || hasCrashFiles(otherDir);
      if (!anyFiles) {
        symbolicationResult = { skipped: true, reason: "No .crash or .ips files found in any crash logs folder" };
      } else {
        let succeeded = 0, failed = 0, total = 0;
        const results: BatchResult[] = [];
        for (const dir of [basicDir, appticsDir, otherDir]) {
          const r = await runBatch(dir, dsymPath, symbolicatedDir, manifest);
          succeeded += r.succeeded; failed += r.failed; total += r.total;
          results.push(...r.results);
        }
        symbolicationResult = { succeeded, failed, total, results };
      }
    }

    // Step 3: Analyze
    const fixStatuses = loadFixStatuses(config.CRASH_ANALYSIS_PARENT);
    let analysisReport = analyzeDirectory(symbolicatedDir, fixStatuses, manifest);

    // Filter unfixed if requested
    if (input.unfixedOnly) {
      analysisReport = filterUnfixedGroups(analysisReport).filtered;
    }

    // Step 4: Always notify Cliq
    const cliqResult = await sendCrashReportToCliq(analysisReport, config);

    // Step 5: Optionally create/update Zoho Projects issues
    let zohoProjectsResult: object | undefined;
    if (input.createZohoProjectIssues) {
      if (!config.ZOHO_PROJECTS_MCP_URL || !config.ZOHO_PROJECTS_PORTAL_ID || !config.ZOHO_PROJECTS_PROJECT_ID) {
        zohoProjectsResult = {
          success: false,
          message: "Zoho Projects configuration missing. Set ZOHO_PROJECTS_MCP_URL, ZOHO_PROJECTS_PORTAL_ID, and ZOHO_PROJECTS_PROJECT_ID env vars.",
        };
      } else {
        const fieldIds = getFieldIdsFromConfig(config);
        zohoProjectsResult = await reportToZohoProjectsViaMcp(
          analysisReport,
          config.ZOHO_PROJECTS_MCP_URL,
          config.ZOHO_PROJECTS_PORTAL_ID,
          config.ZOHO_PROJECTS_PROJECT_ID,
          fieldIds
        );
      }
    }

    const result = {
      export_result: exportResult,
      symbolication_result: symbolicationResult,
      analysis_report: analysisReport,
      cliq_notification: { success: cliqResult.success, message: cliqResult.message },
      zoho_projects_result: zohoProjectsResult,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }
);

// ── Bootstrap ────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();
