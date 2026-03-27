import { getConfig } from "../config.js";
import { FixTracker } from "../fixTracker.js";

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
