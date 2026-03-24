import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { CrashReport, CrashGroup } from "./crashAnalyzer.js";
import type { CrashPointConfig } from "./config.js";

export interface ZohoBugFieldIds {
  statusOpen?: string;
  statusFixed?: string;
  severityCritical?: string;
  severityMajor?: string;
  severityMinor?: string;
}

export interface ZohoBugResult {
  success: boolean;
  title: string;
  severityLabel: string;
  statusLabel: string;
  error?: string;
}

export interface ZohoProjectsReportResult {
  success: boolean;
  message: string;
  totalBugsCreated: number;
  totalFailed: number;
  bugs: ZohoBugResult[];
  missingFieldIds: string[];
}

export function getFieldIdsFromConfig(config: CrashPointConfig): ZohoBugFieldIds {
  return {
    statusOpen: config.ZOHO_BUG_STATUS_OPEN,
    statusFixed: config.ZOHO_BUG_STATUS_FIXED,
    severityCritical: config.ZOHO_BUG_SEVERITY_CRITICAL,
    severityMajor: config.ZOHO_BUG_SEVERITY_MAJOR,
    severityMinor: config.ZOHO_BUG_SEVERITY_MINOR,
  };
}

function mapSeverityId(group: CrashGroup, fieldIds: ZohoBugFieldIds): { id: string | undefined; label: string } {
  const et = group.exception_type.toUpperCase();

  if (et.includes("EXC_BAD_ACCESS") || et.includes("SIGSEGV") || et.includes("SIGBUS")) {
    return { id: fieldIds.severityCritical, label: "Critical" };
  }

  if (et.includes("SIGABRT") || et.includes("EXC_CRASH")) {
    if (group.count >= 10) {
      return { id: fieldIds.severityCritical, label: "Critical" };
    }
    return { id: fieldIds.severityMajor, label: "Major" };
  }

  if (et.includes("EXC_BREAKPOINT") || et.includes("SIGTRAP")) {
    return { id: fieldIds.severityMajor, label: "Major" };
  }

  if (et.includes("EXC_RESOURCE")) {
    return { id: fieldIds.severityMinor, label: "Minor" };
  }

  // Fallback: use occurrence count
  if (group.count >= 20) {
    return { id: fieldIds.severityCritical, label: "Critical" };
  }
  if (group.count >= 5) {
    return { id: fieldIds.severityMajor, label: "Major" };
  }
  return { id: fieldIds.severityMinor, label: "Minor" };
}

function mapStatusId(group: CrashGroup, fieldIds: ZohoBugFieldIds): { id: string | undefined; label: string } {
  if (group.fix_status?.fixed === true) {
    return { id: fieldIds.statusFixed, label: "Fixed" };
  }
  return { id: fieldIds.statusOpen, label: "Open" };
}

function buildDescription(group: CrashGroup, report: CrashReport): string {
  const lines: string[] = [];

  lines.push(`Exception Type: ${group.exception_type}`);
  if (group.exception_codes) {
    lines.push(`Exception Codes: ${group.exception_codes}`);
  }
  lines.push(`Crashed Thread: ${group.crashed_thread.display}`);
  lines.push(`Occurrences: ${group.count}`);
  lines.push(`Rank: #${group.rank} of ${report.unique_crash_types}`);
  lines.push("");

  if (group.top_frames.length > 0) {
    lines.push("Top Stack Frames:");
    for (const frame of group.top_frames) {
      lines.push(`  ${frame}`);
    }
    lines.push("");
  }

  const devices = Object.entries(group.devices);
  if (devices.length > 0) {
    lines.push(`Devices: ${devices.map(([d, n]) => `${d}(${n})`).join(", ")}`);
  }

  const iosVersions = Object.entries(group.ios_versions);
  if (iosVersions.length > 0) {
    lines.push(`iOS Versions: ${iosVersions.map(([v, n]) => `${v}(${n})`).join(", ")}`);
  }

  const appVersions = Object.entries(group.app_versions);
  if (appVersions.length > 0) {
    lines.push(`App Versions: ${appVersions.map(([v, n]) => `${v}(${n})`).join(", ")}`);
  }

  const sources = Object.entries(group.sources);
  if (sources.length > 0) {
    lines.push(`Sources: ${sources.map(([s, n]) => `${s}(${n})`).join(", ")}`);
  }

  lines.push(`Affected Files: ${group.affected_files.length}`);

  if (group.fix_status?.note) {
    lines.push(`Fix Note: ${group.fix_status.note}`);
  }

  lines.push(`Signature: ${group.signature}`);

  return lines.join("\n");
}

export async function reportToZohoProjectsViaMcp(
  report: CrashReport,
  zohoMcpUrl: string,
  portalId: string,
  projectId: string,
  fieldIds: ZohoBugFieldIds
): Promise<ZohoProjectsReportResult> {
  const missingFieldIds: string[] = [];
  if (!fieldIds.statusOpen) missingFieldIds.push("ZOHO_BUG_STATUS_OPEN");
  if (!fieldIds.statusFixed) missingFieldIds.push("ZOHO_BUG_STATUS_FIXED");
  if (!fieldIds.severityCritical) missingFieldIds.push("ZOHO_BUG_SEVERITY_CRITICAL");
  if (!fieldIds.severityMajor) missingFieldIds.push("ZOHO_BUG_SEVERITY_MAJOR");
  if (!fieldIds.severityMinor) missingFieldIds.push("ZOHO_BUG_SEVERITY_MINOR");

  const client = new Client({ name: "crashpoint-ios-mcp", version: "1.0.0" });
  const transport = new SSEClientTransport(new URL(zohoMcpUrl));

  await client.connect(transport);

  const bugs: ZohoBugResult[] = [];
  let totalBugsCreated = 0;
  let totalFailed = 0;

  for (const group of report.crash_groups) {
    const severity = mapSeverityId(group, fieldIds);
    const status = mapStatusId(group, fieldIds);

    const title = `[Crash] ${group.exception_type} — ${group.crashed_thread.display} (${group.count} occurrences)`;
    const description = buildDescription(group, report);

    const toolArgs: Record<string, string> = {
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
      bugs.push({ success: true, title, severityLabel: severity.label, statusLabel: status.label });
      totalBugsCreated++;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      bugs.push({ success: false, title, severityLabel: severity.label, statusLabel: status.label, error });
      totalFailed++;
    }
  }

  try {
    await client.close();
  } catch {
    // Ignore close errors
  }

  const success = totalFailed === 0;
  const message = success
    ? `Successfully created ${totalBugsCreated} bug(s) in Zoho Projects.`
    : `Created ${totalBugsCreated} bug(s), ${totalFailed} failed.`;

  return { success, message, totalBugsCreated, totalFailed, bugs, missingFieldIds };
}
