import fs from "fs";
import path from "path";

export interface SetupAutomationOptions {
  force?: boolean;
  packageRoot: string;
  parentDir: string;
}

export interface SetupAutomationResult {
  automationDir: string;
  scaffolded: string[];
  skipped: string[];
  force: boolean;
}

export function setupAutomationFiles({
  force = false,
  packageRoot,
  parentDir,
}: SetupAutomationOptions): SetupAutomationResult {
  const automationDir = path.join(parentDir, "Automation");
  const logsDir = path.join(automationDir, "ScheduledRunLogs");

  fs.mkdirSync(automationDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  const templateDir = path.join(packageRoot, "automation");
  const scaffolded: string[] = [];
  const skipped: string[] = [];

  // 1. run_crash_pipeline.sh — substitute PARENT_HOLDER_FOLDER placeholder
  const shTemplatePath = path.join(templateDir, "run_crash_pipeline.sh");
  const shDestPath = path.join(automationDir, "run_crash_pipeline.sh");

  if (force || !fs.existsSync(shDestPath)) {
    let shContent = fs.readFileSync(shTemplatePath, "utf-8");
    shContent = shContent.replace(/<REPLACE_WITH_PATH_TO_PARENT_HOLDER_FOLDER>/g, parentDir);
    shContent = shContent.replace(/<REPLACE_WITH_CRASHPOINT_PACKAGE_ROOT>/g, packageRoot);
    fs.writeFileSync(shDestPath, shContent, "utf-8");
    fs.chmodSync(shDestPath, 0o755);
    scaffolded.push("run_crash_pipeline.sh");
  } else {
    skipped.push("run_crash_pipeline.sh (already exists, use force=true to overwrite)");
  }

  // 2. daily_crash_pipeline_prompt_phase1.md — copy as-is
  const promptPhase1TemplatePath = path.join(templateDir, "daily_crash_pipeline_prompt_phase1.md");
  const promptPhase1DestPath = path.join(automationDir, "daily_crash_pipeline_prompt_phase1.md");

  if (force || !fs.existsSync(promptPhase1DestPath)) {
    fs.copyFileSync(promptPhase1TemplatePath, promptPhase1DestPath);
    scaffolded.push("daily_crash_pipeline_prompt_phase1.md");
  } else {
    skipped.push("daily_crash_pipeline_prompt_phase1.md (already exists, use force=true to overwrite)");
  }

  // 3. daily_crash_pipeline_prompt_phase2.md — copy as-is
  const promptPhase2TemplatePath = path.join(templateDir, "daily_crash_pipeline_prompt_phase2.md");
  const promptPhase2DestPath = path.join(automationDir, "daily_crash_pipeline_prompt_phase2.md");

  if (force || !fs.existsSync(promptPhase2DestPath)) {
    fs.copyFileSync(promptPhase2TemplatePath, promptPhase2DestPath);
    scaffolded.push("daily_crash_pipeline_prompt_phase2.md");
  } else {
    skipped.push("daily_crash_pipeline_prompt_phase2.md (already exists, use force=true to overwrite)");
  }

  return { automationDir, scaffolded, skipped, force };
}
