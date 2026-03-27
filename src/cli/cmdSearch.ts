import { getConfig, getSymbolicatedDir } from "../config.js";
import { searchCrashes } from "../core/crashAnalyzer.js";

export function cmdSearch(flags: Record<string, string | boolean>): void {
  const query = flags["query"] as string;
  if (!query) {
    console.error("Error: --query <term> is required for search command.");
    process.exit(1);
  }
  const config = getConfig();
  const crashDir = (flags["crash-dir"] as string) ?? getSymbolicatedDir(config);
  const result = searchCrashes(query, crashDir);
  console.log(JSON.stringify(result, null, 2));
}
