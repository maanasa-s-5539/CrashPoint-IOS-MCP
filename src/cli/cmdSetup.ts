import path from "path";
import { setupWorkspace } from "../core/setup.js";

export function cmdSetup(flags: Record<string, string | boolean>): void {
  const result = setupWorkspace({
    masterBranchPath: flags["master-branch"] as string | undefined,
    devBranchPath: flags["dev-branch"] as string | undefined,
    dsymPath: flags["dsym"] as string | undefined,
    force: Boolean(flags["force"]),
    // __dirname is injected by esbuild banner (points to dist/ directory)
    // Package root is one level up from dist/
    packageRoot: path.resolve(__dirname, ".."),
  });
  console.log(JSON.stringify(result, null, 2));
}

