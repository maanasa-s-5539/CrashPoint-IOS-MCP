import path from "path";
import type { CrashPointConfig } from "./config.js";

export function assertPathUnderBase(userPath: string, base: string): string {
  const resolved = path.resolve(userPath);
  const resolvedBase = path.resolve(base);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new Error(`Path "${userPath}" is outside the allowed directory "${base}"`);
  }
  return resolved;
}

export function assertWritePathUnderBase(writePath: string, config: CrashPointConfig): string {
  const resolved = path.resolve(writePath);
  const resolvedBase = path.resolve(config.CRASH_ANALYSIS_PARENT);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new Error(
      `Write operation rejected: path "${writePath}" is outside ParentHolderFolder "${config.CRASH_ANALYSIS_PARENT}"`
    );
  }
  return resolved;
}

export function assertNoTraversal(userPath: string): string {
  if (userPath.includes("..")) {
    throw new Error(`Path "${userPath}" contains directory traversal`);
  }
  return path.resolve(userPath);
}

const BLOCKED_PREFIXES = ["/etc", "/var/run", "/usr/bin", "/usr/sbin", "/System", "/Library/LaunchDaemons"];

export function assertSafeSymlinkTarget(target: string): void {
  const resolved = path.resolve(target);
  for (const prefix of BLOCKED_PREFIXES) {
    if (resolved.startsWith(prefix + "/") || resolved === prefix) {
      throw new Error(`Symlink target "${target}" points to a restricted system directory`);
    }
  }
}
