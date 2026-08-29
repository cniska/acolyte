import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Effect, EffectInput, EffectResult, RunContext } from "./lifecycle-contract";
import type { EffectOutput, PostToolContext, PreToolContext, SessionContext } from "./tool-contract";
import { type ShellLine, shellTailParts } from "./tool-output-format";
import { OUTPUT_WINDOW_ROWS } from "./tool-policy";
import { DISCOVERY_TOOL_SET, WRITE_TOOL_SET } from "./tool-registry";
import {
  type CommandResult,
  formatWorkspaceCommand,
  renderCommandResult,
  resolveCommandFiles,
  runCommand,
  runCommandWithFiles,
} from "./workspace-profile";
import { ensurePathWithinSandbox } from "./workspace-sandbox";

function commandLines(result: CommandResult): ShellLine[] {
  const lines: ShellLine[] = [];
  for (const [stream, text] of [
    ["stdout", result.stdout],
    ["stderr", result.stderr],
  ] as const) {
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) lines.push({ stream, text: line });
    }
  }
  return lines;
}

/** Draws the effect's own row: the command it ran and what the command said. The row is complete
 *  the moment it is emitted — an effect is host-owned work with no call behind it — so it closes
 *  itself rather than waiting on a tool result that will never arrive. */
function emitEffectRow(ctx: RunContext, toolCallId: string, effectId: string, command: string, lines: ShellLine[]) {
  const sink = ctx.sideEffectSink;
  if (!sink) return;
  const effectCallId = `${toolCallId}:${effectId}`;
  sink({
    type: "tool-output",
    toolName: "effect",
    toolCallId: effectCallId,
    content: { kind: "tool-header", labelKey: "tool.label.effect", detail: command, state: "effect" },
  });
  for (const content of shellTailParts(lines, OUTPUT_WINDOW_ROWS)) {
    sink({ type: "tool-output", toolName: "effect", toolCallId: effectCallId, content });
  }
  ctx.emit({ type: "tool-result", toolCallId: effectCallId, toolName: "effect" });
}

function readIfPresent(workspace: string, path: string): string | null {
  try {
    return readFileSync(ensurePathWithinSandbox(path, workspace), "utf8");
  } catch {
    return null;
  }
}

export const formatEffect: Effect = {
  id: "format",
  run(ctx, input): EffectResult {
    const paths = input?.paths ?? [];
    if (!ctx.workspace || !ctx.policy.formatCommand || paths.length === 0) return { type: "done" };
    const workspace = ctx.workspace;
    // A formatter's own report of what it touched varies by tool and version, so what changed is
    // read from the files themselves. Silence here means the write was already well-formed.
    const before = paths.map((path) => readIfPresent(workspace, path));
    const result = runCommandWithFiles(workspace, ctx.policy.formatCommand, paths);
    const rewritten = paths.filter((path, index) => readIfPresent(workspace, path) !== before[index]);
    if (rewritten.length === 0) return { type: "done" };
    const command = formatWorkspaceCommand(resolveCommandFiles(ctx.policy.formatCommand, paths));
    ctx.debug("lifecycle.effect.format", { files: paths.length, rewritten: rewritten.length });
    if (input?.toolCallId) emitEffectRow(ctx, input.toolCallId, "format", command, commandLines(result));
    return { type: "done" };
  },
};

export const lintEffect: Effect = {
  id: "lint",
  run(ctx, input): EffectResult {
    const paths = input?.paths ?? [];
    if (!ctx.workspace || !ctx.policy.lintCommand || paths.length === 0) return { type: "done" };
    const result = runCommandWithFiles(ctx.workspace, ctx.policy.lintCommand, paths);
    if (!result.hasErrors) return { type: "done" };
    const command = formatWorkspaceCommand(resolveCommandFiles(ctx.policy.lintCommand, paths));
    ctx.debug("lifecycle.effect.lint", { files: paths.length, has_errors: true });
    if (input?.toolCallId) emitEffectRow(ctx, input.toolCallId, "lint", command, commandLines(result));
    return { type: "done", output: `Effect: ${command}\nLint errors:\n${renderCommandResult(result)}` };
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
  if (postCtx.status !== "succeeded") return undefined;
  if (!WRITE_TOOL_SET.has(postCtx.toolId)) return undefined;
  const path = typeof postCtx.args.path === "string" ? postCtx.args.path.trim() : "";
  if (!path) return undefined;
  const effectInput: EffectInput = { paths: [path], toolCallId: postCtx.toolCallId };
  // Effect output is appended to the tool result string in agent-stream, so keep it stable and model-readable.
  const outputs: string[] = [];
  for (const effect of POST_EFFECTS) {
    const result = effect.run(ctx, effectInput);
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
