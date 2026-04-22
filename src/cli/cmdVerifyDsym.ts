import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getConfig, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getMainCrashLogsDir, deriveAppNameFromDsym } from "../config.js";
import { assertNoTraversal, assertPathUnderBase } from "../pathSafety.js";

const execFileAsync = promisify(execFile);

export async function cmdVerifyDsym(flags: Record<string, string | boolean>): Promise<void> {
  const config = getConfig();
  const flagDsym = flags["dsym"] as string | undefined;
  const crashPath = flags["crash"] as string | undefined;
  const crashDir = flags["crash-dir"] as string | undefined;

  const hasDsymFlag = Boolean(flagDsym);
  const hasCrashFlag = Boolean(crashPath || crashDir);

  // Both-or-neither: if only one side is provided, error out
  if (hasDsymFlag && !hasCrashFlag) {
    console.error("Error: --dsym requires --crash or --crash-dir to also be provided. Either supply both or neither.");
    process.exit(1);
  }
  if (!hasDsymFlag && hasCrashFlag) {
    console.error("Error: --crash/--crash-dir requires --dsym to also be provided. Either supply both or neither.");
    process.exit(1);
  }

  // Resolve dSYM path
  let dsymPath: string;
  if (flagDsym) {
    dsymPath = flagDsym;
  } else if (config.DSYM_PATH) {
    dsymPath = config.DSYM_PATH;
  } else {
    const symlinkPath = path.join(config.CRASH_ANALYSIS_PARENT, "dSYM_File");
    try {
      dsymPath = fs.realpathSync(symlinkPath);
    } catch {
      console.error("Error: No dSYM path available. Provide --dsym, set DSYM_PATH env var, or run setup to create the dSYM_File symlink in CRASH_ANALYSIS_PARENT.");
      process.exit(1);
    }
  }

  assertNoTraversal(dsymPath);

  if (!fs.existsSync(dsymPath)) {
    console.error(`Error: dSYM not found at: ${dsymPath}`);
    process.exit(1);
  }

  // Resolve symlink before passing to dwarfdump
  let resolvedDsymPath: string;
  try {
    resolvedDsymPath = fs.realpathSync(dsymPath);
  } catch {
    resolvedDsymPath = dsymPath;
  }

  let dwarfOutput = "";
  try {
    const { stdout } = await execFileAsync("dwarfdump", ["--uuid", resolvedDsymPath]);
    dwarfOutput = stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: dwarfdump failed: ${msg}`);
    process.exit(1);
  }

  const uuidLineRe = /UUID:\s+([0-9A-F-]+)\s+\(([^)]+)\)/gi;
  const dsymUuids: Array<{ arch: string; uuid: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = uuidLineRe.exec(dwarfOutput)) !== null) {
    dsymUuids.push({ uuid: match[1].toUpperCase(), arch: match[2] });
  }

  // Collect crash files
  const crashFiles: string[] = [];
  if (hasCrashFlag) {
    // User explicitly provided crash flags
    if (crashPath) {
      assertNoTraversal(crashPath);
      assertPathUnderBase(crashPath, getMainCrashLogsDir(config));
      crashFiles.push(crashPath);
    }
    if (crashDir) {
      assertPathUnderBase(crashDir, getMainCrashLogsDir(config));
      if (fs.existsSync(crashDir)) {
        fs.readdirSync(crashDir)
          .filter((f) => f.endsWith(".crash") || f.endsWith(".ips"))
          .forEach((f) => crashFiles.push(path.join(crashDir, f)));
      }
    }
  } else {
    // Default: collect from all three subdirectories of MainCrashLogsFolder
    const dirs = [
      getXcodeCrashesDir(config),
      getAppticsCrashesDir(config),
      getOtherCrashesDir(config),
    ];
    for (const dir of dirs) {
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir)
          .filter((f) => f.endsWith(".crash") || f.endsWith(".ips"))
          .forEach((f) => crashFiles.push(path.join(dir, f)));
      }
    }
  }

  if (crashFiles.length === 0) {
    console.log(JSON.stringify({ valid: true, dsymPath, dsymUuids, detail: `dSYM is valid. Found ${dsymUuids.length} UUID(s). No crash files found for UUID comparison.` }, null, 2));
    return;
  }

  const binaryImgRe = /^\s*0x[0-9a-fA-F]+\s+-\s+0x[0-9a-fA-F]+\s+(\S+)\s+\S+\s+<([0-9a-f]{32})>/gim;
  const appName = deriveAppNameFromDsym(dsymPath);
  const crashFileUuids: Array<{ file: string; uuid: string }> = [];

  for (const cf of crashFiles) {
    let content = "";
    try {
      content = fs.readFileSync(cf, "utf-8");
    } catch {
      continue;
    }
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    binaryImgRe.lastIndex = 0;
    while ((m = binaryImgRe.exec(content)) !== null) {
      const binaryName = m[1];
      const rawUuid = m[2];
      if (appName && binaryName !== appName) {
        continue;
      }
      const raw = rawUuid.toUpperCase();
      const uuid = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
      if (!seen.has(uuid)) {
        seen.add(uuid);
        crashFileUuids.push({ file: path.basename(cf), uuid });
      }
    }
  }

  const matches: Array<{ uuid: string; arch: string; matchedFiles: string[] }> = [];
  const mismatches: string[] = [];

  for (const { uuid, arch } of dsymUuids) {
    const matchedFiles = crashFileUuids.filter((c) => c.uuid === uuid).map((c) => c.file);
    if (matchedFiles.length > 0) {
      matches.push({ uuid, arch, matchedFiles });
    } else {
      mismatches.push(`${arch} UUID ${uuid} not found in any provided crash file`);
    }
  }

  const dsymUuidSet = new Set(dsymUuids.map((u) => u.uuid));
  for (const { uuid, file } of crashFileUuids) {
    if (!dsymUuidSet.has(uuid)) {
      mismatches.push(`Crash file ${file} UUID ${uuid} not found in dSYM`);
    }
  }

  const valid = matches.length > 0 && mismatches.length === 0;
  const detail = matches.length > 0
    ? `${matches.length} UUID match(es) found. ${mismatches.length > 0 ? `${mismatches.length} mismatch(es).` : "All UUIDs matched."}`
    : `No UUID matches found. Symbolication will likely fail — ensure the correct dSYM for this build is used.`;

  console.log(JSON.stringify({ valid, dsymPath, dsymUuids, crashFileUuids, matches, mismatches, detail }, null, 2));
}
