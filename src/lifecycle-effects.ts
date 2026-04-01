import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Effect, EffectResult } from "./lifecycle-contract";
import { formatWorkspaceCommand, renderCommandResult, runCommand, runCommandWithFiles } from "./workspace-profile";

export const formatEffect: Effect = {
  id: "format",
  run(ctx, paths = []): EffectResult {
    if (!ctx.workspace || !ctx.policy.formatCommand || paths.length === 0) return { type: "done" };
    runCommandWithFiles(ctx.workspace, ctx.policy.formatCommand, paths);
    ctx.debug("lifecycle.effect.format", { files: paths.length });
    return { type: "done" };
  },
};

export const lintEffect: Effect = {
  id: "lint",
  run(ctx, paths = []): EffectResult {
    if (!ctx.workspace || !ctx.policy.lintCommand || paths.length === 0) return { type: "done" };
    const result = runCommandWithFiles(ctx.workspace, ctx.policy.lintCommand, paths);
    if (!result.hasErrors) return { type: "done" };
    ctx.debug("lifecycle.effect.lint", { files: paths.length, has_errors: true });
    return { type: "done", lintOutput: renderCommandResult(result) };
  },
};

const installedWorkspaces = new Set<string>();

export const installEffect: Effect = {
  id: "install",
  run(ctx): EffectResult {
    if (!ctx.workspace || !ctx.policy.installCommand) return { type: "done" };
    if (installedWorkspaces.has(ctx.workspace)) return { type: "done" };
    const profile = ctx.session.workspaceProfile;
    if (profile?.depsDir && existsSync(join(ctx.workspace, profile.depsDir))) {
      installedWorkspaces.add(ctx.workspace);
      return { type: "done" };
    }
    const result = runCommand(ctx.workspace, ctx.policy.installCommand, 60_000);
    ctx.debug("lifecycle.effect.install", {
      command: formatWorkspaceCommand(ctx.policy.installCommand),
      has_errors: result.hasErrors,
    });
    installedWorkspaces.add(ctx.workspace);
    return { type: "done" };
  },
};

export const POST_EFFECTS: Effect[] = [formatEffect, lintEffect];
export const PRE_EFFECTS: Effect[] = [installEffect];
