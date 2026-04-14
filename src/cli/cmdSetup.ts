import { setupWorkspace } from "../core/setup.js";

export function cmdSetup(flags: Record<string, string | boolean>): void {
  const result = setupWorkspace({
    masterBranchPath: flags["master-branch"] as string | undefined,
    devBranchPath: flags["dev-branch"] as string | undefined,
    dsymPath: flags["dsym"] as string | undefined,
    appPath: flags["app"] as string | undefined,
    force: Boolean(flags["force"]),
  });
  console.log(JSON.stringify(result, null, 2));
}

