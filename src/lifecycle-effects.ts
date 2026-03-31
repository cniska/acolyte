import type { Effect, EffectResult } from "./lifecycle-contract";
import { renderCommandResult, runCommandWithFiles } from "./workspace-profile";

export const formatEffect: Effect = {
  id: "format",
  run(ctx, paths): EffectResult {
    if (!ctx.workspace || !ctx.policy.formatCommand || paths.length === 0) return { type: "done" };
    runCommandWithFiles(ctx.workspace, ctx.policy.formatCommand, paths);
    ctx.debug("lifecycle.effect.format", { files: paths.length });
    return { type: "done" };
  },
};

export const lintEffect: Effect = {
  id: "lint",
  run(ctx, paths): EffectResult {
    if (!ctx.workspace || !ctx.policy.lintCommand || paths.length === 0) return { type: "done" };
    const result = runCommandWithFiles(ctx.workspace, ctx.policy.lintCommand, paths);
    if (!result.hasErrors) return { type: "done" };
    ctx.debug("lifecycle.effect.lint", { files: paths.length, has_errors: true });
    return { type: "done", lintOutput: renderCommandResult(result) };
  },
};

export const EFFECTS: Effect[] = [formatEffect, lintEffect];
