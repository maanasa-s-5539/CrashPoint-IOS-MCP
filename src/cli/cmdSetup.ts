import fs from "fs";
import path from "path";
import { getConfig, getMainCrashLogsDir, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir } from "../config.js";
import { assertNoTraversal, assertSafeSymlinkTarget } from "../pathSafety.js";

export async function cmdSetup(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const parentDir = config.CRASH_ANALYSIS_PARENT;
  const mainCrashDir = getMainCrashLogsDir(config);
  const xcodeCrashDir = getXcodeCrashesDir(config);
  const appticsDir = getAppticsCrashesDir(config);
  const otherDir = getOtherCrashesDir(config);
  const symbolicatedDir = path.join(parentDir, "SymbolicatedCrashLogsFolder");

  const created: string[] = [];
  const warnings: string[] = [];

  // Always create mainCrashDir and xcodeCrashDir
  for (const dir of [parentDir, mainCrashDir, xcodeCrashDir, symbolicatedDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }
  // Create AppticsCrashLogs and OtherCrashLogs only if they don't already exist
  for (const dir of [appticsDir, otherDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }

  const masterBranchPath = (flags["master-branch"] as string) ?? config.MASTER_BRANCH_PATH;
  const devBranchPath = (flags["dev-branch"] as string) ?? config.DEV_BRANCH_PATH;
  const dsymPath = (flags["dsym"] as string) ?? config.DSYM_PATH;
  const appPath = (flags["app"] as string) ?? config.APP_PATH;

  const symlinkDefs: Array<{ name: string; target: string | undefined }> = [
    { name: "CurrentMasterLiveBranch", target: masterBranchPath },
    { name: "CurrentDevelopmentBranch", target: devBranchPath },
    { name: "dSYM_File", target: dsymPath },
    { name: "app_File", target: appPath },
  ];

  const symlinks: Array<{ link: string; target: string; status: string }> = [];
  for (const { name, target } of symlinkDefs) {
    if (!target) continue;
    assertNoTraversal(target);
    assertSafeSymlinkTarget(target);
    const resolvedTarget = path.resolve(target);
    const linkPath = path.join(parentDir, name);
    if (!fs.existsSync(resolvedTarget)) {
      warnings.push(`Target for ${name} does not exist: ${resolvedTarget}`);
    }
    try {
      fs.lstatSync(linkPath);
      fs.rmSync(linkPath, { force: true });
    } catch {
      // Path doesn't exist — nothing to remove
    }
    let symlinkType: "dir" | "file" = "file";
    if (fs.existsSync(resolvedTarget)) {
      symlinkType = fs.statSync(resolvedTarget).isDirectory() ? "dir" : "file";
    } else {
      // Target doesn't exist yet — infer type from path extension
      const lowerTarget = resolvedTarget.toLowerCase();
      if (
        lowerTarget.endsWith(".dsym") ||
        lowerTarget.endsWith(".app") ||
        lowerTarget.endsWith(".framework") ||
        !path.extname(resolvedTarget)
      ) {
        symlinkType = "dir";
      }
    }
    try {
      fs.symlinkSync(resolvedTarget, linkPath, symlinkType);
      symlinks.push({ link: linkPath, target: resolvedTarget, status: "created" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not create symlink ${name}: ${msg}`);
      symlinks.push({ link: linkPath, target: resolvedTarget, status: `failed: ${msg}` });
    }
  }

  const existingCrashLogsDir = flags["crash-logs"] as string | undefined;
  let copiedFiles: number | undefined;
  if (existingCrashLogsDir) {
    copiedFiles = 0;
    try {
      const srcFiles = fs.readdirSync(existingCrashLogsDir).filter(
        (f) => f.endsWith(".crash") || f.endsWith(".ips")
      );
      for (const file of srcFiles) {
        fs.copyFileSync(path.join(existingCrashLogsDir, file), path.join(xcodeCrashDir, file));
        copiedFiles++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not copy from crash-logs dir: ${msg}`);
    }
  }

  console.log(JSON.stringify({ parentDir, created, symlinks, copiedFiles, warnings }, null, 2));
}
