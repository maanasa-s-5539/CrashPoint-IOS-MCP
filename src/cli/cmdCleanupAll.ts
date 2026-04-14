import { cleanupAll } from "../core/cleanup.js";

export function cmdCleanupAll(flags: Record<string, string | boolean>): void {
  const result = cleanupAll({
    dryRun: Boolean(flags["dry-run"]),
    keepReports: Boolean(flags["keep-reports"]),
    keepManifests: Boolean(flags["keep-manifests"]),
  });
  console.log(JSON.stringify(result, null, 2));
}
