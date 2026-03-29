import type { LifecycleEffect, LifecycleEffectAction, RunContext } from "./lifecycle-contract";
import { scopedCallLog } from "./tool-guards";
import { WRITE_TOOL_SET } from "./tool-registry";
import { type CommandResult, runCommandWithFiles } from "./workspace-profile";

function renderCommandOutput(result: CommandResult): string {
  if (!result.stderr) return result.stdout;
  if (!result.stdout) return result.stderr;
  return `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`;
}

function writePathsForCurrentTask(ctx: RunContext): string[] {
  const out = new Set<string>();
  for (const entry of scopedCallLog(ctx.session, ctx.taskId)) {
    if (!WRITE_TOOL_SET.has(entry.toolName)) continue;
    const path = entry.args?.path;
    if (typeof path !== "string") continue;
    const trimmed = path.trim();
    if (trimmed.length === 0) continue;
    out.add(trimmed);
  }
  return Array.from(out);
}

export function runFormatIfConfigured(
  ctx: RunContext,
  runWithFiles: typeof runCommandWithFiles = runCommandWithFiles,
): LifecycleEffectAction {
  if (ctx.mode !== "work" || !ctx.workspace || !ctx.policy.formatCommand) return { type: "done" };
  const paths = writePathsForCurrentTask(ctx);
  if (paths.length === 0) return { type: "done" };
  runWithFiles(ctx.workspace, ctx.policy.formatCommand, paths);
  ctx.debug("lifecycle.effect.format", { files: paths.length });
  return { type: "done" };
}

export function runLintIfConfigured(
  ctx: RunContext,
  runWithFiles: typeof runCommandWithFiles = runCommandWithFiles,
): LifecycleEffectAction {
  if (ctx.mode !== "work" || !ctx.workspace || !ctx.policy.lintCommand) return { type: "done" };
  const paths = writePathsForCurrentTask(ctx);
  if (paths.length === 0) return { type: "done" };
  const result = runWithFiles(ctx.workspace, ctx.policy.lintCommand, paths);
  if (!result.hasErrors) return { type: "done" };
  ctx.debug("lifecycle.effect.lint", { files: paths.length });
  return {
    type: "regenerate",
    feedback: {
      source: "lint",
      mode: "work",
      summary: "Lint errors detected in files you edited.",
      details: renderCommandOutput(result),
      instruction: "Fix the issues above, then stop.",
    },
  };
}

export const formatEffect: LifecycleEffect = {
  id: "format",
  run: (ctx) => runFormatIfConfigured(ctx),
};

export const lintEffect: LifecycleEffect = {
  id: "lint",
  run: (ctx) => runLintIfConfigured(ctx),
};
