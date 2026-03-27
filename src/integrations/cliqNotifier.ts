import type { CrashReport, CrashGroup } from "../core/crashAnalyzer.js";
import type { CrashPointConfig } from "../config.js";

function formatCrashGroup(group: CrashGroup, index: number): string {
  const lines: string[] = [];
  lines.push(`**#${group.rank} — ${group.exception_type}** (${group.count} crashes)`);
  lines.push(`Exception Codes: ${group.exception_codes || "N/A"}`);
  lines.push(`Crashed Thread: ${group.crashed_thread.display}`);
  lines.push("Top Frames:");
  for (const frame of group.top_frames) {
    lines.push(`  • ${frame}`);
  }
  const devicesSummary = Object.entries(group.devices)
    .map(([k, v]) => `${k}(${v})`)
    .join(", ");
  lines.push(`Devices: ${devicesSummary || "N/A"}`);
  const iosSummary = Object.entries(group.ios_versions)
    .map(([k, v]) => `${k}(${v})`)
    .join(", ");
  lines.push(`iOS Versions: ${iosSummary || "N/A"}`);
  const appVSummary = Object.entries(group.app_versions)
    .map(([k, v]) => `${k}(${v})`)
    .join(", ");
  lines.push(`App Versions: ${appVSummary || "N/A"}`);

  // Sources
  const sourceLabels: Record<string, string> = {
    "xcode-organizer": "Xcode Organizer",
    "apptics": "Apptics",
    "ips-file": ".ips file",
    "manual": "Manual",
  };
  const sourcesSummary = Object.entries(group.sources)
    .map(([k, v]) => `${sourceLabels[k] ?? k}(${v})`)
    .join(", ");
  lines.push(`Sources: ${sourcesSummary || "N/A"}`);

  // Fix status
  if (group.fix_status) {
    if (group.fix_status.fixed) {
      lines.push(`Fix Status: [FIXED] Fixed in dev${group.fix_status.note ? ` — ${group.fix_status.note}` : ""}`);
    } else {
      lines.push(`Fix Status: [NOT FIXED] Not yet fixed${group.fix_status.note ? ` — ${group.fix_status.note}` : ""}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function formatCrashReportText(report: CrashReport): string {
  const isUnfixedOnly = report.report_type === "unfixed-only";
  const headerLine = isUnfixedOnly
    ? `[WARNING] *Unfixed iOS Crashes — ${report.report_date}*`
    : `*iOS Crash Report — ${report.report_date}*`;
  const header = [
    headerLine,
    `Total crashes: ${report.total_crashes} | Unique types: ${report.unique_crash_types}`,
    `Source: ${report.source_dir}`,
    "",
  ].join("\n");

  const body = report.crash_groups
    .map((g, i) => formatCrashGroup(g, i))
    .join("\n---\n");

  return header + body;
}

const CLIQ_MAX_LENGTH = 5000;

export function splitIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  const sections = text.split("\n---\n");

  let current = "";
  for (const section of sections) {
    const separator = current ? "\n---\n" : "";
    if ((current + separator + section).length > maxLength) {
      if (current) chunks.push(current);
      current = section;
    } else {
      current = current + separator + section;
    }
  }
  if (current) chunks.push(current);

  // If any single chunk is still over limit, split by newlines
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxLength) {
      finalChunks.push(chunk);
    } else {
      const lines = chunk.split("\n");
      let part = "";
      for (const line of lines) {
        const candidate = part ? part + "\n" + line : line;
        if (candidate.length > maxLength) {
          if (part) finalChunks.push(part);
          part = line;
        } else {
          part = candidate;
        }
      }
      if (part) finalChunks.push(part);
    }
  }

  return finalChunks;
}

function validateWebhookUrl(url: string): void {
  const parsed = new URL(url);
  const allowedHosts = ["cliq.zoho.com", "cliq.zoho.in", "cliq.zoho.eu", "cliq.zoho.com.au", "cliq.zoho.jp"];
  if (!allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith("." + h))) {
    throw new Error(`Webhook URL must be a Zoho Cliq domain, got: ${parsed.hostname}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Webhook URL must use HTTPS");
  }
}

async function postToCliq(webhookUrl: string, text: string): Promise<void> {
  validateWebhookUrl(webhookUrl);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Webhook POST failed: ${response.status} ${body}`);
  }
}

export async function sendToWebhook(webhookUrl: string, report: CrashReport): Promise<void> {
  const fullText = formatCrashReportText(report);

  if (fullText.length <= CLIQ_MAX_LENGTH) {
    await postToCliq(webhookUrl, fullText);
    return;
  }

  const chunks = splitIntoChunks(fullText, CLIQ_MAX_LENGTH);
  for (const chunk of chunks) {
    await postToCliq(webhookUrl, chunk);
  }
}

export async function sendCrashReportToCliq(
  report: CrashReport,
  config: CrashPointConfig
): Promise<{ success: boolean; message: string }> {
  const channelUrl = config.ZOHO_CLIQ_WEBHOOK_URL;

  if (!channelUrl) {
    return {
      success: false,
      message: "No Zoho Cliq webhook URL configured. Set ZOHO_CLIQ_WEBHOOK_URL.",
    };
  }

  try {
    await sendToWebhook(channelUrl, report);
    return { success: true, message: "Report sent to Cliq channel webhook." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Channel webhook failed: ${msg}` };
  }
}
