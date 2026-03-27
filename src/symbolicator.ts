import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { ProcessedManifest, extractIncidentId } from "./processedManifest.js";

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

export interface FrameDiag {
  index: number;
  library: string;
  address: string;
  originalSymbol: string;
  resolvedSymbol: string;
  symbolicated: boolean;
}

export interface DiagnoseResult {
  appFramesSymbolicated: number;
  appFramesMissed: number;
  totalFrames: number;
  frames: FrameDiag[];
}

const FRAME_REGEX = /^\s*(\d+)\s+(\S+)\s+(0x[0-9a-fA-F]+)/;

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

export function diagnoseFrames(
  crashPath: string,
  symbolicatedPath: string,
  appName?: string
): DiagnoseResult {
  if (!fs.existsSync(crashPath) || !fs.existsSync(symbolicatedPath)) {
    return { appFramesSymbolicated: 0, appFramesMissed: 0, totalFrames: 0, frames: [] };
  }

  const origLines = fs.readFileSync(crashPath, "utf-8").split("\n");
  const symLines = fs.readFileSync(symbolicatedPath, "utf-8").split("\n");

  const frames: FrameDiag[] = [];
  let symbolicated = 0;
  let missed = 0;

  for (let i = 0; i < origLines.length; i++) {
    const origMatch = FRAME_REGEX.exec(origLines[i]);
    if (!origMatch) continue;

    const frameLib = origMatch[2];
    if (appName && frameLib !== appName) continue;

    const symLine = symLines[i] || origLines[i];
    const symMatch = FRAME_REGEX.exec(symLine);

    const origSymbol = origMatch[3]; // address
    const resolvedSymbol = symMatch ? symMatch[3] : origSymbol;
    const wasSymbolicated = resolvedSymbol !== origSymbol;

    if (wasSymbolicated) symbolicated++;
    else missed++;

    frames.push({
      index: parseInt(origMatch[1], 10),
      library: frameLib,
      address: origMatch[3],
      originalSymbol: origSymbol,
      resolvedSymbol,
      symbolicated: wasSymbolicated,
    });
  }

  return {
    appFramesSymbolicated: symbolicated,
    appFramesMissed: missed,
    totalFrames: frames.length,
    frames,
  };
}
