import path from "path";
import { getConfig } from "../config.js";
import { symbolicateOne } from "../core/symbolicator.js";
import { assertPathUnderBase, assertNoTraversal } from "../pathSafety.js";

export async function cmdSymbolicateOne(flags: Record<string, string | boolean>): Promise<void> {
  const crashPath = flags["crash"] as string;
  if (!crashPath) {
    console.error("Error: --crash <path> is required for symbolicate-one command.");
    process.exit(1);
  }
  const config = getConfig();
  const dsymPath = (flags["dsym"] as string) ?? config.DSYM_PATH;
  const outputPath = (flags["output"] as string) ?? path.join(config.CRASH_ANALYSIS_PARENT, "SymbolicatedCrashLogsFolder", path.basename(crashPath));

  if (flags["output"]) {
    assertPathUnderBase(outputPath, config.CRASH_ANALYSIS_PARENT);
  }

  if (!dsymPath) {
    console.error("Error: --dsym or DSYM_PATH env var is required.");
    process.exit(1);
  }

  assertNoTraversal(crashPath);

  const result = await symbolicateOne(crashPath, dsymPath, outputPath);
  console.log(JSON.stringify(result, null, 2));
  if (result.success) {
    console.log(`Symbolicated output written to ${path.resolve(outputPath)}`);
  }
}
