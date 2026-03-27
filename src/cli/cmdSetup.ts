import { setupWorkspace } from "../core/setup.js";

export async function cmdSetup(flags: Record<string, string | boolean>): Promise<void> {
  const result = await setupWorkspace({
    masterBranchPath: flags["master-branch"] as string | undefined,
    devBranchPath: flags["dev-branch"] as string | undefined,
    dsymPath: flags["dsym"] as string | undefined,
    appPath: flags["app"] as string | undefined,
    existingCrashLogsDir: flags["crash-logs"] as string | undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}

