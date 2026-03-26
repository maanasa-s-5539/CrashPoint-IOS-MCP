import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CrashGroup, CrashReport } from "./crashAnalyzer.js";
import type { CrashPointConfig } from "./config.js";

// ── Field ID Configuration ────────────────────────────────────────────────────

export interface ZohoBugFieldIds {
  statusOpen?: string;
  statusFixed?: string;
  severityShowStopper?: string;
  severityCritical?: string;
  severityMajor?: string;
  severityMinor?: string;
  severityNone?: string;
}

export function getFieldIdsFromConfig(config: CrashPointConfig): ZohoBugFieldIds {
  return {
    statusOpen: config.ZOHO_BUG_STATUS_OPEN,
    statusFixed: config.ZOHO_BUG_STATUS_FIXED,
    severityShowStopper: config.ZOHO_BUG_SEVERITY_SHOWSTOPPER,
    severityCritical: config.ZOHO_BUG_SEVERITY_CRITICAL,
    severityMajor: config.ZOHO_BUG_SEVERITY_MAJOR,
    severityMinor: config.ZOHO_BUG_SEVERITY_MINOR,
    severityNone: config.ZOHO_BUG_SEVERITY_NONE,
  };
}

// ── Severity Mapping ──────────────────────────────────────────────────────────

export function mapSeverityId(
  group: CrashGroup,
  fieldIds: ZohoBugFieldIds
): { id: string | undefined; label: string } {
  const exType = group.exception_type.toUpperCase();
  const count = group.count;

  // EXC_BAD_ACCESS / SIGSEGV / SIGBUS → always Critical
  if (
    exType.includes("EXC_BAD_ACCESS") ||
    exType.includes("SIGSEGV") ||
    exType.includes("SIGBUS")
  ) {
    return { id: fieldIds.severityCritical, label: "Critical" };
  }

  // SIGABRT / EXC_CRASH → Major if ≥10, Minor if <10
  if (exType.includes("SIGABRT") || exType.includes("EXC_CRASH")) {
    if (count >= 10) {
      return { id: fieldIds.severityMajor, label: "Major" };
    }
    return { id: fieldIds.severityMinor, label: "Minor" };
  }

  // EXC_BREAKPOINT / SIGTRAP → always Major
  if (exType.includes("EXC_BREAKPOINT") || exType.includes("SIGTRAP")) {
    return { id: fieldIds.severityMajor, label: "Major" };
  }

  // Any other exception type — count-based rules
  if (count >= 20) {
    return { id: fieldIds.severityShowStopper, label: "ShowStopper" };
  }
  if (count >= 10) {
    return { id: fieldIds.severityMajor, label: "Major" };
  }
  if (count >= 2) {
    // covers 2–4 (explicit Minor range) and 5–9 (Minor fallback per spec)
    return { id: fieldIds.severityMinor, label: "Minor" };
  }
  // count === 1
  return { id: fieldIds.severityNone, label: "None" };
}

// ── Status Mapping ────────────────────────────────────────────────────────────

export function mapStatusId(
  group: CrashGroup,
  fieldIds: ZohoBugFieldIds
): { id: string | undefined; label: string } {
  if (group.fix_status?.fixed === true) {
    return { id: fieldIds.statusFixed, label: "Fixed" };
  }
  return { id: fieldIds.statusOpen, label: "Open" };
}

// ── Description Builder ───────────────────────────────────────────────────────

export function buildDescription(group: CrashGroup, report: CrashReport): string {
  const deviceList = Object.entries(group.devices)
    .sort(([, a], [, b]) => b - a)
    .map(([dev, count]) => `${dev} (${count})`)
    .join(", ");

  const iosList = Object.entries(group.ios_versions)
    .sort(([, a], [, b]) => b - a)
    .map(([ver, count]) => `${ver} (${count})`)
    .join(", ");

  const appVersionList = Object.entries(group.app_versions)
    .sort(([, a], [, b]) => b - a)
    .map(([ver, count]) => `${ver} (${count})`)
    .join(", ");

  const sourceList = Object.entries(group.sources)
    .sort(([, a], [, b]) => b - a)
    .map(([src, count]) => `${src} (${count})`)
    .join(", ");

  const topFrames = group.top_frames.map((f, i) => `  ${i}: ${f}`).join("\n");

  const fixNote = group.fix_status?.note ? `\nFix Note: ${group.fix_status.note}` : "";

  return [
    `Crash Report — ${report.report_date}`,
    ``,
    `Exception Type: ${group.exception_type}`,
    `Exception Codes: ${group.exception_codes}`,
    `Crashed Thread: ${group.crashed_thread.display}`,
    `Occurrences: ${group.count}`,
    `Rank: #${group.rank} of ${report.unique_crash_types} unique crash types`,
    ``,
    `Top Stack Frames:`,
    topFrames,
    ``,
    `Devices: ${deviceList || "N/A"}`,
    `iOS Versions: ${iosList || "N/A"}`,
    `App Versions: ${appVersionList || "N/A"}`,
    `Sources: ${sourceList || "N/A"}`,
    ``,
    `Affected Files: ${group.affected_files.length} crash log(s)`,
    fixNote,
    ``,
    `Signature: ${group.signature}`,
  ].join("\n");
}

// ── Result Types ──────────────────────────────────────────────────────────────

export interface ZohoBugResult {
  success: boolean;
  title: string;
  severityLabel: string;
  statusLabel: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface ZohoProjectsReportResult {
  success: boolean;
  message: string;
  totalBugsCreated: number;
  totalFailed: number;
  totalSkipped: number;
  bugs: ZohoBugResult[];
  missingFieldIds: string[];
}

// ── Existing Bug Fetcher ──────────────────────────────────────────────────────

const OCCURRENCES_PATTERN = /Occurrences:\s*(\d+)/;

interface ExistingBug {
  id: string;
  title: string;
  description?: string;
}

export async function fetchExistingBugs(
  client: Client,
  portalId: string,
  projectId: string
): Promise<ExistingBug[]> {
  try {
    const result = await client.callTool({
      name: "getProjectIssues",
      arguments: {
        portal_id: portalId,
        project_id: projectId,
      },
    });

    // The MCP tool result content is an array of content blocks.
    // The bug data is typically JSON inside a text content block.
    const content = result.content;
    if (!Array.isArray(content) || content.length === 0) return [];

    const textBlock = content.find(
      (c: unknown) => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text"
    ) as { text: string } | undefined;
    if (!textBlock) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return [];
    }

    // The parsed value may be an array directly, or an object with a bugs/issues array.
    let bugsData: Array<Record<string, unknown>>;
    if (Array.isArray(parsed)) {
      bugsData = parsed as Array<Record<string, unknown>>;
    } else if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>).bugs)
    ) {
      bugsData = (parsed as Record<string, unknown>).bugs as Array<Record<string, unknown>>;
    } else if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>).issues)
    ) {
      bugsData = (parsed as Record<string, unknown>).issues as Array<Record<string, unknown>>;
    } else {
      return [];
    }

    return bugsData.map((bug) => {
      return {
        id: String(bug.id ?? bug.bug_id ?? ""),
        title: String(bug.title ?? ""),
        description: bug.description !== undefined ? String(bug.description) : undefined,
      };
    });
  } catch {
    // Graceful degradation: if the tool is unavailable or the call fails,
    // return an empty list so all bugs are created as before.
    return [];
  }
}

// ── MCP Bridge ────────────────────────────────────────────────────────────────

export async function reportToZohoProjectsViaMcp(
  report: CrashReport,
  zohoMcpUrl: string,
  portalId: string,
  projectId: string,
  fieldIds: ZohoBugFieldIds
): Promise<ZohoProjectsReportResult> {
  // Detect which field ID env vars are not configured
  const missingFieldIds: string[] = [];
  if (!fieldIds.statusOpen) missingFieldIds.push("ZOHO_BUG_STATUS_OPEN");
  if (!fieldIds.statusFixed) missingFieldIds.push("ZOHO_BUG_STATUS_FIXED");
  if (!fieldIds.severityShowStopper) missingFieldIds.push("ZOHO_BUG_SEVERITY_SHOWSTOPPER");
  if (!fieldIds.severityCritical) missingFieldIds.push("ZOHO_BUG_SEVERITY_CRITICAL");
  if (!fieldIds.severityMajor) missingFieldIds.push("ZOHO_BUG_SEVERITY_MAJOR");
  if (!fieldIds.severityMinor) missingFieldIds.push("ZOHO_BUG_SEVERITY_MINOR");
  if (!fieldIds.severityNone) missingFieldIds.push("ZOHO_BUG_SEVERITY_NONE");

  if (report.crash_groups.length === 0) {
    return {
      success: true,
      message: "No crash groups to report.",
      totalBugsCreated: 0,
      totalFailed: 0,
      totalSkipped: 0,
      bugs: [],
      missingFieldIds,
    };
  }

  // Connect to Zoho Projects MCP server
  const transport = new StreamableHTTPClientTransport(new URL(zohoMcpUrl));
  const client = new Client(
    { name: "crashpoint-ios-mcp", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Failed to connect to Zoho Projects MCP server: ${msg}`,
      totalBugsCreated: 0,
      totalFailed: report.crash_groups.length,
      totalSkipped: 0,
      bugs: [],
      missingFieldIds,
    };
  }

  // Fetch existing bugs for duplicate detection (graceful degradation if unavailable)
  const existingBugs = await fetchExistingBugs(
    client,
    portalId,
    projectId
  );

  const bugs: ZohoBugResult[] = [];

  try {
    for (const group of report.crash_groups) {
      const title = `[Crash] ${group.exception_type} — ${group.crashed_thread.display} (${group.count} occurrences)`;
      const description = buildDescription(group, report);
      const severity = mapSeverityId(group, fieldIds);
      const status = mapStatusId(group, fieldIds);

      // Check for a duplicate: match on title (case-insensitive)
      const normalizedTitle = title.trim().toLowerCase();
      const existingBug = existingBugs.find((eb) => eb.title.trim().toLowerCase() === normalizedTitle);

      if (existingBug) {
        // Duplicate found — parse occurrences from existing description and accumulate
        const existingOccurrences = (() => {
          const match = existingBug.description?.match(OCCURRENCES_PATTERN);
          return match ? parseInt(match[1], 10) : 0;
        })();
        const newOccurrences = existingOccurrences + group.count;

        const baseDescription = buildDescription(group, report);
        const updatedDescription = baseDescription.replace(
          OCCURRENCES_PATTERN,
          `Occurrences: ${newOccurrences}`
        );

        try {
          await client.callTool({
            name: "updateIssue",
            arguments: {
              portal_id: portalId,
              project_id: projectId,
              bug_id: existingBug.id,
              description: updatedDescription,
              ...(severity.id !== undefined ? { severity_id: severity.id } : {}),
            },
          });
          bugs.push({
            success: true,
            title,
            severityLabel: severity.label,
            statusLabel: status.label,
            skipped: true,
            skipReason: `Duplicate bug already exists (matched on title). Updated description with accumulated occurrences from ${existingOccurrences} to ${newOccurrences}.`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          bugs.push({
            success: false,
            title,
            severityLabel: severity.label,
            statusLabel: status.label,
            skipped: true,
            skipReason: `Duplicate detected but failed to update description: ${msg}`,
            error: msg,
          });
        }
        continue;
      }

      const toolArgs: Record<string, unknown> = {
        portal_id: portalId,
        project_id: projectId,
        title,
        description,
      };

      if (status.id !== undefined) {
        toolArgs.status_id = status.id;
      }
      if (severity.id !== undefined) {
        toolArgs.severity_id = severity.id;
      }

      try {
        await client.callTool({ name: "create_bug", arguments: toolArgs });
        bugs.push({
          success: true,
          title,
          severityLabel: severity.label,
          statusLabel: status.label,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        bugs.push({
          success: false,
          title,
          severityLabel: severity.label,
          statusLabel: status.label,
          error: msg,
        });
      }
    }
  } finally {
    await client.close();
  }

  const totalBugsCreated = bugs.filter((b) => b.success && !b.skipped).length;
  const totalFailed = bugs.filter((b) => !b.success).length;
  const totalSkipped = bugs.filter((b) => b.skipped).length;

  return {
    success: totalFailed === 0,
    message: `Created ${totalBugsCreated} bug(s) in Zoho Projects${
      totalSkipped > 0 ? `, ${totalSkipped} updated (duplicates)` : ""
    }${totalFailed > 0 ? `, ${totalFailed} failed` : ""}.`,
    totalBugsCreated,
    totalFailed,
    totalSkipped,
    bugs,
    missingFieldIds,
  };
}
