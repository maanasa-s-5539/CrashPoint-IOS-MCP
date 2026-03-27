import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { ProcessedManifest, extractIncidentId } from "../state/processedManifest.js";
import { getConfig, getXcodeCrashesDir, getAppticsCrashesDir, getOtherCrashesDir, getSymbolicatedDir } from "../config.js";

const execFileAsync = promisify(execFile);

const SYMBOLICATE_CRASH =
  "/Applications/Xcode.app/Contents/SharedFrameworks/DVTFoundation.framework/Versions/A/Resources/symbolicatecrash";
const DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";

export interface SymbolicateResult {
  success: boolean;
  detail: string;
}

export interface BatchResult {
  file: string;
  success: boolean;
  detail: string;
}

export async function symbolicateOne(
  crashPath: string,
  dsymPath: string,
  outputPath: string,
): Promise<SymbolicateResult> {
  if (!fs.existsSync(crashPath)) {
    return { success: false, detail: `Crash file not found: ${crashPath}` };
  }
  if (!fs.existsSync(dsymPath)) {
    return { success: false, detail: `dSYM not found: ${dsymPath}` };
  }
  if (!fs.existsSync(SYMBOLICATE_CRASH)) {
    return { success: false, detail: `symbolicatecrash not found at: ${SYMBOLICATE_CRASH}` };
  }

  if (fs.existsSync(dsymPath)) {
    dsymPath = fs.realpathSync(dsymPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const env = { ...process.env, DEVELOPER_DIR };

  try {
    const { stdout } = await execFileAsync(SYMBOLICATE_CRASH, ["-d", dsymPath, crashPath], { env });
    fs.writeFileSync(outputPath, stdout, "utf-8");
    return {
      success: true,
      detail: `Symbolicated output written to ${outputPath}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, detail: `symbolicatecrash failed: ${msg}` };
  }
}

export async function runBatch(
  crashDir: string,
  dsymPath: string,
  outputDir: string,
  manifest?: ProcessedManifest,
): Promise<{ succeeded: number; failed: number; total: number; results: BatchResult[] }> {
  if (!fs.existsSync(crashDir)) {
    return { succeeded: 0, failed: 0, total: 0, results: [] };
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const files = fs.readdirSync(crashDir).filter((f) => f.endsWith(".crash") || f.endsWith(".ips"));
  const results: BatchResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const file of files) {
    const crashPath = path.join(crashDir, file);
    const outputPath = path.join(outputDir, file);

    const incidentId = extractIncidentId(crashPath);
    const manifestKey = incidentId ?? crashPath;
    if (manifest && manifest.isProcessed(manifestKey)) {
      results.push({ file, success: true, detail: "skipped (already processed)" });
      continue;
    }

    const res = await symbolicateOne(crashPath, dsymPath, outputPath);
    results.push({ file, ...res });
    if (res.success) {
      succeeded++;
      manifest?.markProcessed(manifestKey);
    } else {
      failed++;
    }
  }

  return { succeeded, failed, total: files.length, results };
}

export async function runBatchAll(
  dsymPath: string,
  manifest?: ProcessedManifest,
): Promise<{ succeeded: number; failed: number; total: number; results: BatchResult[] }> {
  const config = getConfig();
  const xcodeCrashDir = getXcodeCrashesDir(config);
  const appticsDir = getAppticsCrashesDir(config);
  const otherDir = getOtherCrashesDir(config);
  const outputDir = getSymbolicatedDir(config);

  let succeeded = 0;
  let failed = 0;
  let total = 0;
  const results: BatchResult[] = [];

  for (const dir of [xcodeCrashDir, appticsDir, otherDir]) {
    const r = await runBatch(dir, dsymPath, outputDir, manifest);
    succeeded += r.succeeded;
    failed += r.failed;
    total += r.total;
    results.push(...r.results);
  }

  return { succeeded, failed, total, results };
}
