import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Effect, EffectInput, EffectResult, RunContext } from "./lifecycle-contract";
import type { EffectOutput, PostToolContext, PreToolContext, SessionContext } from "./tool-contract";
import { type ShellLine, shellTailParts } from "./tool-output-format";
import { OUTPUT_WINDOW_ROWS } from "./tool-policy";
import { DISCOVERY_TOOL_SET } from "./tool-registry";
import type { WorkspaceCommand } from "./workspace-contract";
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

function emitEffectRow(ctx: RunContext, effect: string, command: string, lines: ShellLine[]): void {
  ctx.sideEffectSink?.({
    type: "effect",
    row: { effect, command, output: shellTailParts(lines, OUTPUT_WINDOW_ROWS) },
  });
}

function readIfPresent(workspace: string, path: string): string | null {
  try {
    return readFileSync(ensurePathWithinSandbox(path, workspace), "utf8");
  } catch {
    return null;
  }
}

function isPresent(workspace: string, path: string): boolean {
  try {
    return existsSync(ensurePathWithinSandbox(path, workspace));
  } catch {
    return false;
  }
}

export const formatEffect: Effect = {
  id: "format",
  async run(ctx, input): Promise<EffectResult> {
    const paths = input?.paths ?? [];
    if (!ctx.workspace || !ctx.policy.formatCommand || paths.length === 0) return { type: "done" };
    const workspace = ctx.workspace;
    // A formatter's account of what it touched varies by tool and version, so what changed is read
    // from the files themselves.
    const before = paths.map((path) => readIfPresent(workspace, path));
    const result = await runCommandWithFiles(workspace, ctx.policy.formatCommand, paths);
    const rewritten = paths.filter((path, index) => readIfPresent(workspace, path) !== before[index]);
    const command = formatWorkspaceCommand(resolveCommandFiles(ctx.policy.formatCommand, paths));
    // The trace keeps every run; the transcript keeps only the ones that changed something.
    ctx.debug("lifecycle.effect.format", { command, files: paths.length, rewritten: rewritten.length });
    if (rewritten.length > 0) emitEffectRow(ctx, "format", command, commandLines(result));
    return { type: "done" };
  },
};

export const lintEffect: Effect = {
  id: "lint",
  async run(ctx, input): Promise<EffectResult> {
    const paths = input?.paths ?? [];
    if (!ctx.workspace || !ctx.policy.lintCommand || paths.length === 0) return { type: "done" };
    const result = await runCommandWithFiles(ctx.workspace, ctx.policy.lintCommand, paths);
    const command = formatWorkspaceCommand(resolveCommandFiles(ctx.policy.lintCommand, paths));
    ctx.debug("lifecycle.effect.lint", { command, files: paths.length, has_errors: result.hasErrors });
    if (!result.hasErrors) return { type: "done" };
    emitEffectRow(ctx, "lint", command, commandLines(result));
    return { type: "done", output: `Effect: ${command}\nLint errors:\n${renderCommandResult(result)}` };
  },
};

// Keyed by workspace and holding the run itself, not a done-marker: two sessions reaching a fresh
// checkout at once would otherwise both find nothing installed and both start installing. `settled`
// separates a caller that waited for the install from one that arrived after it finished.
type InstallRun = { result: Promise<CommandResult>; settled: boolean };

const installs = new Map<string, InstallRun>();

async function installOnce(
  ctx: RunContext,
  workspace: string,
  command: WorkspaceCommand,
): Promise<CommandResult | null> {
  const started = installs.get(workspace);
  if (started) return started.settled ? null : started.result;
  const profile = ctx.session.workspaceProfile;
  if (profile?.depsDir && existsSync(join(workspace, profile.depsDir))) return null;
  const entry: InstallRun = {
    settled: false,
    result: runCommand(workspace, command, 60_000).then((result) => {
      ctx.debug("lifecycle.effect.install", {
        command: formatWorkspaceCommand(command),
        has_errors: result.hasErrors,
      });
      // A failed install is not a settled one. Forget it so the next tool call tries again,
      // rather than leaving the workspace without dependencies for the daemon's lifetime.
      if (result.hasErrors) installs.delete(workspace);
      else entry.settled = true;
      return result;
    }),
  };
  installs.set(workspace, entry);
  return entry.result;
}

export const installEffect: Effect = {
  id: "install",
  async run(ctx): Promise<EffectResult> {
    const { workspace, policy } = ctx;
    if (!workspace || !policy.installCommand) return { type: "done" };
    const result = await installOnce(ctx, workspace, policy.installCommand);
    // An install holds up the tool that triggered it for as long as it takes, so the wait gets a
    // row; a workspace whose dependencies were already there waited for nothing and draws none.
    if (result) emitEffectRow(ctx, "install", formatWorkspaceCommand(policy.installCommand), commandLines(result));
    return { type: "done" };
  },
};

export const POST_EFFECTS: Effect[] = [formatEffect, lintEffect];
export const PRE_EFFECTS: Effect[] = [installEffect];

function mergeEffectOutputs(a: EffectOutput | undefined, b: EffectOutput | undefined): EffectOutput | undefined {
  const append = [a?.append, b?.append].filter(Boolean).join("\n");
  return append ? { append } : undefined;
}

async function preToolSideEffects(ctx: RunContext, preCtx: PreToolContext): Promise<void> {
  if (DISCOVERY_TOOL_SET.has(preCtx.toolId)) return;
  for (const effect of PRE_EFFECTS) {
    await effect.run(ctx);
  }
}

// Effects run one after another, and all of them before the tool's result is assembled: the next
// write cannot start while a formatter is still rewriting the file this one produced.
async function postToolSideEffects(ctx: RunContext, postCtx: PostToolContext): Promise<EffectOutput | undefined> {
  if (postCtx.status !== "succeeded") return undefined;
  if (!ctx.session.writeTools.has(postCtx.toolId)) return undefined;
  const path = typeof postCtx.args.path === "string" ? postCtx.args.path.trim() : "";
  if (!path) return undefined;
  // A write that removed the file leaves nothing to format or lint, and a linter pointed at a path
  // that is gone reports it missing.
  if (!ctx.workspace || !isPresent(ctx.workspace, path)) return undefined;
  const effectInput: EffectInput = { paths: [path] };
  const outputs: string[] = [];
  for (const effect of POST_EFFECTS) {
    const result = await effect.run(ctx, effectInput);
    if (result.output) outputs.push(result.output);
  }
  const append = outputs.filter((out) => out.trim().length > 0).join("\n");
  return append ? { append } : undefined;
}

export function attachLifecycleEffectHandlers(ctx: RunContext, session: SessionContext): void {
  const prevBefore = session.onBeforeToolAsync;
  const prevAfter = session.onAfterToolAsync;
  session.onBeforeToolAsync = async (preCtx) => {
    await prevBefore?.(preCtx);
    await preToolSideEffects(ctx, preCtx);
  };
  session.onAfterToolAsync = async (postCtx) =>
    mergeEffectOutputs(await prevAfter?.(postCtx), await postToolSideEffects(ctx, postCtx));
}
