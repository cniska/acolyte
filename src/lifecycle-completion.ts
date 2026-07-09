import type { LifecycleSignal } from "./agent-contract";
import type { ToolCallRecord } from "./tool-contract";

export type CompletionBlockReason = "broken-handoff" | "missing-validation-after-write" | "empty-answer";

export type CompletionBlock = {
  reason: CompletionBlockReason;
  message: string;
  path: string;
};

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

export function findCompletionBlock(input: {
  signal?: LifecycleSignal;
  finalText: string;
  callLog: readonly ToolCallRecord[];
  writeToolSet: ReadonlySet<string>;
  runnerToolSet: ReadonlySet<string>;
}): CompletionBlock | undefined {
  if (input.signal !== "done" && input.signal !== "noop") return undefined;

  // Work-quality gates apply only to `done` — a `noop` asserts no work was done.
  if (input.signal === "done") {
    const brokenHandoff = findBrokenHandoff(input.callLog, input.runnerToolSet);
    if (brokenHandoff) {
      const label = brokenHandoff.command ? `\`${brokenHandoff.command}\`` : `\`${brokenHandoff.toolName}\``;
      return {
        reason: "broken-handoff",
        path: brokenHandoff.command ?? brokenHandoff.toolName,
        message: `Cannot finish yet: the last ${label} run failed (exit code ${brokenHandoff.exitCode}). Diagnose the failure and fix it, or call \`signal_blocked\` if recovery is genuinely impossible.`,
      };
    }

    const lastWrite = findLastSourceWrite(input.callLog, input.writeToolSet);
    if (lastWrite) {
      const laterCalls = input.callLog.slice(lastWrite.index + 1);
      const relatedPaths = relatedValidationPaths(lastWrite.path);
      const validated = laterCalls.some(
        (entry) => isGreenRunner(entry, input.runnerToolSet) && runnerTargets(entry, relatedPaths),
      );
      if (!validated) {
        return {
          reason: "missing-validation-after-write",
          path: lastWrite.path,
          message: `Cannot finish yet: \`${lastWrite.path}\` changed and no later validation targeted it. Run a related test or command, or say why validation is blocked.`,
        };
      }
    }
  }

  // Both signals carry the model's own words — a `done` is the final response,
  // a `noop` is why no changes were needed. An empty answer is not a completion.
  if (input.finalText.trim().length === 0) {
    return {
      reason: "empty-answer",
      path: "",
      message:
        input.signal === "noop"
          ? "Cannot finish yet: you called `signal_noop` without telling the user why no changes were needed."
          : "Cannot finish yet: you called `signal_done` without writing a final response to the user.",
    };
  }

  return undefined;
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

function relatedValidationPaths(writtenPath: string): readonly string[] {
  const paths = new Set<string>([writtenPath]);
  const testCompanion = writtenPath.replace(/\.(tsx?|jsx?|mts|cts)$/, ".test.$1");
  if (testCompanion !== writtenPath) paths.add(testCompanion);
  const sourceCompanion = writtenPath.replace(/\.test\.(tsx?|jsx?|mts|cts)$/, ".$1");
  if (sourceCompanion !== writtenPath) paths.add(sourceCompanion);
  return Array.from(paths);
}

function runnerTargets(entry: ToolCallRecord, candidatePaths: readonly string[]): boolean {
  const explicit = collectExplicitTargets(entry);
  if (explicit.length === 0) return true;
  return explicit.some((target) => candidatePaths.some((candidate) => pathMatches(target, candidate)));
}

function collectExplicitTargets(entry: ToolCallRecord): string[] {
  const targets: string[] = [];
  const args = entry.args;
  if (Array.isArray(args.files)) {
    for (const file of args.files) if (typeof file === "string") targets.push(file);
  }
  if (Array.isArray(args.args)) {
    for (const arg of args.args) if (typeof arg === "string" && looksLikePath(arg)) targets.push(arg);
  }
  if (typeof args.command === "string") {
    for (const token of args.command.split(/\s+/)) if (looksLikePath(token)) targets.push(token);
  }
  return targets;
}

function looksLikePath(token: string): boolean {
  if (token.includes("/")) return true;
  return /\.(tsx?|jsx?|mts|cts)$/.test(token);
}

function pathMatches(target: string, candidate: string): boolean {
  if (target === candidate) return true;
  if (target.endsWith(`/${candidate}`)) return true;
  return false;
}
