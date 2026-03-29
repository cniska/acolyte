import type { Effect, EffectAction, RunContext } from "./lifecycle-contract";
import { scopedCallLog } from "./tool-guards";
import { WRITE_TOOL_SET } from "./tool-registry";
import { renderCommandResult, runCommandWithFiles } from "./workspace-profile";

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

export const formatEffect: Effect = {
  id: "format",
  modes: ["work"],
  run: (ctx): EffectAction => {
    if (!ctx.workspace || !ctx.policy.formatCommand) return { type: "done" };
    const paths = writePathsForCurrentTask(ctx);
    if (paths.length === 0) return { type: "done" };
    runCommandWithFiles(ctx.workspace, ctx.policy.formatCommand, paths);
    ctx.debug("lifecycle.effect.format", { files: paths.length });
    return { type: "done" };
  },
};

export const lintEffect: Effect = {
  id: "lint",
  modes: ["work"],
  run: (ctx): EffectAction => {
    if (!ctx.workspace || !ctx.policy.lintCommand) return { type: "done" };
    const paths = writePathsForCurrentTask(ctx);
    if (paths.length === 0) return { type: "done" };
    const result = runCommandWithFiles(ctx.workspace, ctx.policy.lintCommand, paths);
    if (!result.hasErrors) return { type: "done" };
    ctx.debug("lifecycle.effect.lint", { files: paths.length });
    return {
      type: "regenerate",
      feedback: {
        source: "lint",
        mode: "work",
        summary: "Lint errors detected in files you edited.",
        details: renderCommandResult(result),
        instruction: "Fix the issues above, then stop.",
      },
    };
  },
};
