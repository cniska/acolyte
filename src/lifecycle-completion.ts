import type { LifecycleSignal } from "./lifecycle-contract";
import type { ToolCallRecord } from "./tool-session";

export type CompletionBlockReason = "broken-handoff" | "missing-validation-after-write";

export type CompletionBlock = {
  reason: CompletionBlockReason;
  message: string;
  path: string;
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

export function findCompletionBlock(input: {
  signal?: LifecycleSignal;
  callLog: readonly ToolCallRecord[];
  writeToolSet: ReadonlySet<string>;
  runnerToolSet: ReadonlySet<string>;
}): CompletionBlock | undefined {
  if (input.signal !== "done") return undefined;

  const brokenHandoff = findBrokenHandoff(input.callLog, input.runnerToolSet);
  if (brokenHandoff) {
    const label = brokenHandoff.command ? `\`${brokenHandoff.command}\`` : `\`${brokenHandoff.toolName}\``;
    return {
      reason: "broken-handoff",
      path: brokenHandoff.command ?? brokenHandoff.toolName,
      message: `Cannot finish yet: the last ${label} run failed (exit code ${brokenHandoff.exitCode}). Diagnose the failure and fix it, or use \`@signal blocked\` if recovery is genuinely impossible.`,
    };
  }

  const lastWrite = findLastSourceWrite(input.callLog, input.writeToolSet);
  if (!lastWrite) return undefined;

  const laterCalls = input.callLog.slice(lastWrite.index + 1);
  if (laterCalls.some((entry) => isGreenRunner(entry, input.runnerToolSet))) return undefined;

  return {
    reason: "missing-validation-after-write",
    path: lastWrite.path,
    message: `Cannot finish yet: \`${lastWrite.path}\` changed after the last successful validation. Run focused validation, or say why validation is blocked.`,
  };
}

function findBrokenHandoff(
  callLog: readonly ToolCallRecord[],
  runnerToolSet: ReadonlySet<string>,
): { toolName: string; exitCode: number; command?: string } | undefined {
  for (let i = callLog.length - 1; i >= 0; i--) {
    const entry = callLog[i];
    if (!runnerToolSet.has(entry.toolName)) continue;
    if (isGreenRunner(entry, runnerToolSet)) return undefined;
    const exitCode = typeof entry.exitCode === "number" ? entry.exitCode : 1;
    const command = typeof entry.args.command === "string" ? entry.args.command : undefined;
    return { toolName: entry.toolName, exitCode, command };
  }
  return undefined;
}

function findLastSourceWrite(
  callLog: readonly ToolCallRecord[],
  writeToolSet: ReadonlySet<string>,
): { index: number; path: string } | undefined {
  for (let index = callLog.length - 1; index >= 0; index--) {
    const entry = callLog[index];
    if (!writeToolSet.has(entry.toolName)) continue;
    const path = entry.args.path;
    if (typeof path !== "string" || !isSourcePath(path)) continue;
    return { index, path };
  }
  return undefined;
}

function isSourcePath(path: string): boolean {
  const normalized = path.toLowerCase();
  for (const ext of SOURCE_EXTENSIONS) {
    if (normalized.endsWith(ext)) return true;
  }
  return false;
}

function isGreenRunner(entry: ToolCallRecord, runnerToolSet: ReadonlySet<string>): boolean {
  if (!runnerToolSet.has(entry.toolName)) return false;
  if (typeof entry.exitCode === "number") return entry.exitCode === 0;
  return entry.status === "succeeded";
}
