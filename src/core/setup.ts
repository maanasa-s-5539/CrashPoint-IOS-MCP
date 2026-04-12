import fs from "fs";
import os from "os";
import path from "path";
import { getConfig, getMainCrashLogsDir, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir, getAnalyzedReportsDir, getStateMaintenanceDir, getAutomationDir } from "../config.js";
import { assertNoTraversal, assertSafeSymlinkTarget } from "../pathSafety.js";
import { getAutomationTemplates, generateMcpJson, generatePlist, FullCrashPointConfig } from "./automationTemplates.js";

export interface SetupOptions {
  masterBranchPath?: string;
  devBranchPath?: string;
  dsymPath?: string;
  appPath?: string;
}

export interface SetupResult {
  parentDir: string;
  created: string[];
  symlinks: Array<{ link: string; target: string; status: string }>;
  scaffoldedFiles: string[];
  warnings: string[];
}

export function setupWorkspace(options: SetupOptions = {}): SetupResult {
  const config = getConfig();
  const parentDir = config.CRASH_ANALYSIS_PARENT;
  const mainCrashDir = getMainCrashLogsDir(config);
  const xcodeCrashDir = getXcodeCrashesDir(config);
  const appticsDir = getAppticsCrashesDir(config);
  const otherDir = getOtherCrashesDir(config);
  const symbolicatedDir = getSymbolicatedDir(config);

  const created: string[] = [];
  const warnings: string[] = [];

  const dirsToCreate = [
    parentDir, mainCrashDir, xcodeCrashDir, appticsDir, otherDir,
    symbolicatedDir, getAnalyzedReportsDir(config), getStateMaintenanceDir(config), getAutomationDir(config),
    path.join(getAutomationDir(config), "FixPlans"),
  ];
  for (const dir of dirsToCreate) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }

  // ─── Scaffold automation templates ────────────────────────────────────────
  const automationDir = getAutomationDir(config);
  const scaffoldedFiles: string[] = [];
  const templates = getAutomationTemplates(parentDir);

  for (const { filename, content, executable } of templates) {
    const destPath = path.join(automationDir, filename);
    if (!fs.existsSync(destPath)) {
      fs.writeFileSync(destPath, content, "utf-8");
      if (executable) {
        fs.chmodSync(destPath, 0o755);
      }
      scaffoldedFiles.push(destPath);
    }
  }

  // ─── Build full config from raw JSON + typed config ───────────────────────
  const configJsonPath = path.join(parentDir, "crashpoint.config.json");
  let rawConfig: Record<string, unknown> = {};
  if (fs.existsSync(configJsonPath)) {
    try {
      rawConfig = JSON.parse(fs.readFileSync(configJsonPath, "utf-8")) as Record<string, unknown>;
    } catch {
      // ignore parse errors — rawConfig stays empty
    }
  }
  const fullConfig: FullCrashPointConfig = {
    ...rawConfig,
    CRASH_ANALYSIS_PARENT: config.CRASH_ANALYSIS_PARENT,
    DSYM_PATH: config.DSYM_PATH,
    APP_PATH: config.APP_PATH,
    APP_NAME: config.APP_NAME,
    MASTER_BRANCH_PATH: config.MASTER_BRANCH_PATH,
    DEV_BRANCH_PATH: config.DEV_BRANCH_PATH,
    CRASH_VERSIONS: config.CRASH_VERSIONS,
  };

  // ─── Generate .mcp.json if not already present ───────────────────────────
  const mcpJsonPath = path.join(parentDir, ".mcp.json");
  if (!fs.existsSync(mcpJsonPath)) {
    fs.writeFileSync(mcpJsonPath, generateMcpJson(fullConfig), "utf-8");
    scaffoldedFiles.push(mcpJsonPath);
  }

  // ─── Generate launchd plist if not already present ───────────────────────
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(launchAgentsDir, "com.crashpipeline.daily_mcp.plist");
  if (!fs.existsSync(plistPath)) {
    try {
      if (!fs.existsSync(launchAgentsDir)) {
        fs.mkdirSync(launchAgentsDir, { recursive: true });
      }
      fs.writeFileSync(plistPath, generatePlist(fullConfig), "utf-8");
      scaffoldedFiles.push(plistPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Could not write launchd plist to ${plistPath}: ${msg}`);
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

  return { parentDir, created, symlinks, scaffoldedFiles, warnings };
}
