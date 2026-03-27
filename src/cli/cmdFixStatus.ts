import { getConfig } from "../config.js";
import { FixTracker } from "../fixTracker.js";

export function cmdFixStatus(flags: Record<string, string | boolean>): void {
  const action = flags["action"] as string;
  const signature = flags["signature"] as string | undefined;
  const note = flags["note"] as string | undefined;

  if (!action || !["set", "unset", "list"].includes(action)) {
    console.error('Error: --action <set|unset|list> is required for fix-status command.');
    process.exit(1);
  }

  const config = getConfig();
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);

  if (action === "list") {
    console.log(JSON.stringify(tracker.getAll(), null, 2));
    return;
  }

  if (!signature) {
    console.error(`Error: --signature <sig> is required for action "${action}".`);
    process.exit(1);
  }

  if (action === "set") {
    const fixed = flags["fixed"] !== false;
    tracker.setFixed(signature, fixed, note);
    console.log(`Marked as ${fixed ? "fixed" : "unfixed"}: ${signature}${note ? ` (note: ${note})` : ""}`);
  } else {
    tracker.setFixed(signature, false);
    console.log(`Marked as unfixed: ${signature}`);
  }
}

export function cmdSetFix(signature: string, flags: Record<string, string | boolean>): void {
  const config = getConfig();
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  const note = flags["note"] as string | undefined;
  tracker.setFixed(signature, true, note);
  console.log(`Marked as fixed: ${signature}${note ? ` (note: ${note})` : ""}`);
}

export function cmdUnsetFix(signature: string): void {
  const config = getConfig();
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  tracker.setFixed(signature, false);
  console.log(`Marked as unfixed: ${signature}`);
}

export function cmdListFixes(): void {
  const config = getConfig();
  const tracker = new FixTracker(config.CRASH_ANALYSIS_PARENT);
  console.log(JSON.stringify(tracker.getAll(), null, 2));
}

