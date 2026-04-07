import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Effect, EffectResult, RunContext } from "./lifecycle-contract";
import { DISCOVERY_TOOL_SET, WRITE_TOOL_SET } from "./tool-registry";
import type { EffectOutput, PostToolContext, PreToolContext, SessionContext } from "./tool-session";
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
    return { type: "done", output: `Lint errors:\n${renderCommandResult(result)}` };
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

function mergeEffectOutputs(a: EffectOutput | undefined, b: EffectOutput | undefined): EffectOutput | undefined {
  const append = [a?.append, b?.append].filter(Boolean).join("\n");
  return append ? { append } : undefined;
}

function preToolSideEffects(ctx: RunContext, preCtx: PreToolContext): EffectOutput | undefined {
  if (DISCOVERY_TOOL_SET.has(preCtx.toolId)) return undefined;
  for (const effect of PRE_EFFECTS) {
    effect.run(ctx);
  }
  return undefined;
}

function postToolSideEffects(ctx: RunContext, postCtx: PostToolContext): EffectOutput | undefined {
  if (!WRITE_TOOL_SET.has(postCtx.toolId)) return undefined;
  const path = typeof postCtx.args.path === "string" ? postCtx.args.path.trim() : "";
  if (!path) return undefined;
  const paths = [path];
  // Effect output is appended to the tool result string in agent-stream, so keep it stable and model-readable.
  const outputs: string[] = [];
  for (const effect of POST_EFFECTS) {
    const result = effect.run(ctx, paths);
    if (result.output) outputs.push(result.output);
  }
  const append = outputs.filter((out) => out.trim().length > 0).join("\n");
  return append ? { append } : undefined;
}

export function attachLifecycleEffectHandlers(ctx: RunContext, session: SessionContext): void {
  const prevBefore = session.onBeforeTool;
  const prevAfter = session.onAfterTool;
  session.onBeforeTool = (preCtx) => mergeEffectOutputs(prevBefore?.(preCtx), preToolSideEffects(ctx, preCtx));
  session.onAfterTool = (postCtx) => mergeEffectOutputs(prevAfter?.(postCtx), postToolSideEffects(ctx, postCtx));
}
