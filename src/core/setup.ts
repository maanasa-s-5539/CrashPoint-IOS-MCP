import fs from "fs";
import path from "path";
import { getConfig, getMainCrashLogsDir, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir } from "../config.js";
import { assertNoTraversal, assertSafeSymlinkTarget } from "../pathSafety.js";

export interface SetupOptions {
  masterBranchPath?: string;
  devBranchPath?: string;
  dsymPath?: string;
  appPath?: string;
  existingCrashLogsDir?: string;
}

export interface SetupResult {
  parentDir: string;
  created: string[];
  symlinks: Array<{ link: string; target: string; status: string }>;
  copiedFiles?: number;
  warnings: string[];
}

export async function setupWorkspace(options: SetupOptions = {}): Promise<SetupResult> {
  const config = getConfig();
  const parentDir = config.CRASH_ANALYSIS_PARENT;
  const mainCrashDir = getMainCrashLogsDir(config);
  const xcodeCrashDir = getXcodeCrashesDir(config);
  const appticsDir = getAppticsCrashesDir(config);
  const otherDir = getOtherCrashesDir(config);
  const symbolicatedDir = getSymbolicatedDir(config);

  const created: string[] = [];
  const warnings: string[] = [];

  for (const dir of [parentDir, mainCrashDir, xcodeCrashDir, symbolicatedDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }
  for (const dir of [appticsDir, otherDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }

  const symlinkDefs: Array<{ name: string; target: string | undefined }> = [
    { name: "CurrentMasterLiveBranch", target: options.masterBranchPath ?? config.MASTER_BRANCH_PATH },
    { name: "CurrentDevelopmentBranch", target: options.devBranchPath ?? config.DEV_BRANCH_PATH },
    { name: "dSYM_File", target: options.dsymPath ?? config.DSYM_PATH },
    { name: "app_File", target: options.appPath ?? config.APP_PATH },
  ];

  const symlinks: Array<{ link: string; target: string; status: string }> = [];

  for (const { name, target } of symlinkDefs) {
    if (!target) continue;
    assertNoTraversal(target);
    assertSafeSymlinkTarget(target);
    const resolvedTarget = path.resolve(target);
    const linkPath = path.join(parentDir, name);
    let status: string;

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
      status = "created";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      status = `failed: ${msg}`;
      warnings.push(`Could not create symlink ${name}: ${msg}`);
    }

    symlinks.push({ link: linkPath, target: resolvedTarget, status });
  }

  let copiedFiles: number | undefined;
  if (options.existingCrashLogsDir) {
    copiedFiles = 0;
    try {
      const srcFiles = fs.readdirSync(options.existingCrashLogsDir).filter(
        (f) => f.endsWith(".crash") || f.endsWith(".ips")
      );
      for (const file of srcFiles) {
        const src = path.join(options.existingCrashLogsDir, file);
        const dest = path.join(xcodeCrashDir, file);
        fs.copyFileSync(src, dest);
        copiedFiles++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not copy from existingCrashLogsDir: ${msg}`);
    }
  }

  return { parentDir, created, symlinks, copiedFiles, warnings };
}
