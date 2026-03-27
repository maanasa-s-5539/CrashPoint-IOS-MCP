import { assertNoTraversal } from "../pathSafety.js";
import { readCrash } from "../core/crashAnalyzer.js";

export function cmdRead(flags: Record<string, string | boolean>): void {
  const crashPath = flags["crash"] as string;
  if (!crashPath) {
    console.error("Error: --crash <path> is required for read command.");
    process.exit(1);
  }
  assertNoTraversal(crashPath);
  const meta = readCrash(crashPath);
  if (!meta) {
    console.error(`Error: Could not read or parse crash file: ${crashPath}`);
    process.exit(1);
  }
  console.log(JSON.stringify(meta, null, 2));
}
