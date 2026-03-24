import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface BinaryImage {
  loadAddress: string;
  name: string;
  arch: string;
  uuid: string;
  filePath: string;
}

export interface StackFrame {
  index: number;
  library: string;
  address: string;
  symbol?: string;
}

export interface SymbolicateResult {
  success: boolean;
  detail: string;
  symbolicatedCount: number;
  totalAppFrames: number;
}

export interface BatchResult {
  file: string;
  success: boolean;
  detail: string;
  symbolicatedCount: number;
  totalAppFrames: number;
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

const BINARY_IMAGE_REGEX =
  /^\s*\+?\s*(0x[0-9a-fA-F]+)\s*-\s*(0x[0-9a-fA-F]+)\s+\+?(\S+)\s+(\S+)\s+<([0-9a-fA-F-]+)>\s*(.*)/;
const FRAME_REGEX = /^\s*(\d+)\s+(\S+)\s+(0x[0-9a-fA-F]+)/;
const CRASHED_THREAD_REGEX = /^Thread\s+(\d+)\s+Crashed/;

function parseBinaryImages(lines: string[]): Map<string, BinaryImage> {
  const images = new Map<string, BinaryImage>();
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith("Binary Images:")) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (line.trim() === "" && images.size > 0) break;
    const match = BINARY_IMAGE_REGEX.exec(line);
    if (match) {
      // Groups: 1=loadAddr, 2=endAddr, 3=name, 4=arch, 5=uuid, 6=filePath
      const name = match[3].replace(/^\+/, "");
      const img: BinaryImage = {
        loadAddress: match[1],
        name,
        arch: match[4],
        uuid: match[5],
        filePath: match[6].trim(),
      };
      images.set(name, img);
    }
  }
  return images;
}

function parseCrashedThreadFrames(lines: string[], allThreads: boolean): Map<string, StackFrame[]> {
  const threadFrames = new Map<string, StackFrame[]>();
  let currentThread: string | null = null;
  let crashedThread: string | null = null;
  let inThreadSection = false;

  for (const line of lines) {
    const crashedMatch = CRASHED_THREAD_REGEX.exec(line);
    if (crashedMatch) {
      crashedThread = crashedMatch[1];
    }
    if (/^Thread\s+\d+/.exec(line)) {
      const tMatch = /^Thread\s+(\d+)/.exec(line);
      if (tMatch) {
        currentThread = tMatch[1];
        inThreadSection = true;
        if (!threadFrames.has(currentThread)) {
          threadFrames.set(currentThread, []);
        }
      }
    } else if (line.trim() === "" && inThreadSection) {
      inThreadSection = false;
      currentThread = null;
    }

    if (inThreadSection && currentThread !== null) {
      const frameMatch = FRAME_REGEX.exec(line);
      if (frameMatch) {
        const frame: StackFrame = {
          index: parseInt(frameMatch[1], 10),
          library: frameMatch[2],
          address: frameMatch[3],
        };
        threadFrames.get(currentThread)!.push(frame);
      }
    }
  }

  if (allThreads) {
    return threadFrames;
  }

  // Only return crashed thread
  const result = new Map<string, StackFrame[]>();
  const key = crashedThread ?? (threadFrames.size > 0 ? Array.from(threadFrames.keys())[0] : null);
  if (key !== null && threadFrames.has(key)) {
    result.set(key, threadFrames.get(key)!);
  }
  return result;
}

function findDwarfBinary(dsymPath: string, appName?: string): string | null {
  const dwarfDir = path.join(dsymPath, "Contents", "Resources", "DWARF");
  if (!fs.existsSync(dwarfDir)) return null;

  if (appName) {
    const candidate = path.join(dwarfDir, appName);
    if (fs.existsSync(candidate)) return candidate;
  }

  // Return first file in DWARF dir
  const files = fs.readdirSync(dwarfDir);
  if (files.length > 0) return path.join(dwarfDir, files[0]);
  return null;
}

const VALID_HEX_ADDRESS = /^0x[0-9a-fA-F]+$/;
const VALID_ARCHS = ["arm64", "x86_64", "armv7", "armv7s", "arm64e", "i386"];

export async function runAtos(
  dsymPath: string,
  appPath: string | undefined,
  loadAddress: string,
  addresses: string[],
  arch?: string
): Promise<string[]> {
  if (addresses.length === 0) return [];

  if (!VALID_HEX_ADDRESS.test(loadAddress)) {
    throw new Error(`Invalid load address: "${loadAddress}". Must match 0x[0-9a-fA-F]+`);
  }
  const invalidAddr = addresses.find((a) => !VALID_HEX_ADDRESS.test(a));
  if (invalidAddr !== undefined) {
    throw new Error(`Invalid address: "${invalidAddr}". Must match 0x[0-9a-fA-F]+`);
  }
  if (arch !== undefined && !VALID_ARCHS.includes(arch)) {
    throw new Error(`Invalid arch: "${arch}". Must be one of: ${VALID_ARCHS.join(", ")}`);
  }

  const dwarfBinary = findDwarfBinary(dsymPath, appPath ? path.basename(appPath) : undefined);
  const binaryArg = dwarfBinary ?? (appPath || dsymPath);

  const args: string[] = ["-o", binaryArg, "-l", loadAddress];
  if (arch) {
    args.push("-arch", arch);
  }
  args.push(...addresses);

  try {
    const { stdout } = await execFileAsync("atos", args);
    return stdout.trim().split("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`atos failed: ${msg}`);
  }
}

export async function symbolicateOne(
  crashPath: string,
  dsymPath: string,
  appPath: string | undefined,
  outputPath: string,
  archOverride?: string,
  allThreads = false
): Promise<SymbolicateResult> {
  if (!fs.existsSync(crashPath)) {
    return { success: false, detail: `Crash file not found: ${crashPath}`, symbolicatedCount: 0, totalAppFrames: 0 };
  }
  if (!fs.existsSync(dsymPath)) {
    return { success: false, detail: `dSYM not found: ${dsymPath}`, symbolicatedCount: 0, totalAppFrames: 0 };
  }

  const content = fs.readFileSync(crashPath, "utf-8");
  const lines = content.split("\n");

  const binaryImages = parseBinaryImages(lines);
  const threadFrameMap = parseCrashedThreadFrames(lines, allThreads);

  let symbolicatedCount = 0;
  let totalAppFrames = 0;

  // Collect app name to find the matching binary image
  const appBinaryName = appPath ? path.basename(appPath, path.extname(appPath)) : undefined;

  // Find load address for app binary
  let appImage: BinaryImage | undefined;
  if (appBinaryName && binaryImages.has(appBinaryName)) {
    appImage = binaryImages.get(appBinaryName);
  } else {
    // Try to find by dsym name
    const dsymBaseName = path.basename(dsymPath, ".dSYM");
    appImage = binaryImages.get(dsymBaseName);
  }

  if (!appImage && (appBinaryName || dsymPath)) {
    // Fallback: case-insensitive or file-path-based match
    const needle = (appBinaryName ?? path.basename(dsymPath, ".dSYM")).toLowerCase();
    for (const [, image] of binaryImages) {
      if (image.name.toLowerCase() === needle) {
        appImage = image;
        break;
      }
      if (image.filePath.toLowerCase().includes(needle)) {
        appImage = image;
        break;
      }
    }
  }

  if (!appImage) {
    return {
      success: false,
      detail: "Could not find app binary in crash file's Binary Images section",
      symbolicatedCount: 0,
      totalAppFrames: 0,
    };
  }

  // Collect all frames from the app binary across all threads to symbolicate
  const framesToSymbolicate: { threadId: string; frameIdx: number; address: string }[] = [];
  for (const [threadId, frames] of threadFrameMap) {
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (frame.library === appImage.name || (appBinaryName && frame.library === appBinaryName)) {
        totalAppFrames++;
        framesToSymbolicate.push({ threadId, frameIdx: i, address: frame.address });
      }
    }
  }

  let symbols: string[] = [];
  if (framesToSymbolicate.length > 0) {
    try {
      symbols = await runAtos(
        dsymPath,
        appPath,
        appImage.loadAddress,
        framesToSymbolicate.map((f) => f.address),
        archOverride ?? appImage.arch
      );
      symbolicatedCount = symbols.filter((s) => !s.startsWith("0x")).length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, detail: msg, symbolicatedCount: 0, totalAppFrames };
    }
  }

  // Build symbolicated output
  const symbolMap = new Map<string, string>();
  framesToSymbolicate.forEach((f, idx) => {
    if (symbols[idx]) {
      symbolMap.set(`${f.threadId}:${f.frameIdx}`, symbols[idx]);
    }
  });

  const outputLines = [...lines];
  for (const [threadId, frames] of threadFrameMap) {
    for (let i = 0; i < frames.length; i++) {
      const sym = symbolMap.get(`${threadId}:${i}`);
      if (sym) {
        // Replace the address in the line with the symbolicated name
        const frame = frames[i];
        for (let lineIdx = 0; lineIdx < outputLines.length; lineIdx++) {
          if (outputLines[lineIdx].includes(frame.address)) {
            outputLines[lineIdx] = outputLines[lineIdx].replace(frame.address, sym);
            break;
          }
        }
      }
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, outputLines.join("\n"), "utf-8");

  return {
    success: true,
    detail: `Symbolicated ${symbolicatedCount} of ${totalAppFrames} app frames`,
    symbolicatedCount,
    totalAppFrames,
  };
}

export async function runBatch(
  crashDir: string,
  dsymPath: string,
  appPath: string | undefined,
  outputDir: string,
  archOverride?: string,
  allThreads = false
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
    const res = await symbolicateOne(crashPath, dsymPath, appPath, outputPath, archOverride, allThreads);
    results.push({ file, ...res });
    if (res.success) succeeded++;
    else failed++;
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
