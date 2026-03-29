import { readFileSync } from "node:fs";
import type { AgentMode } from "./agent-contract";
import type { VerifyScope } from "./api";
import type { LifecycleError, LifecycleEventName, LifecycleFeedback, LifecycleState } from "./lifecycle-contract";
import type { LifecyclePolicy } from "./lifecycle-policy";
import { normalizePath } from "./tool-arg-paths";
import { haveChangesBeenVerified, type SessionContext, scopedCallLog } from "./tool-guards";
import { WRITE_TOOL_SET, WRITE_TOOLS } from "./tool-registry";
import { type CommandResult, runCommandWithFiles } from "./workspace-profile";

function renderCommandOutput(result: CommandResult): string {
  if (!result.stderr) return result.stdout;
  if (!result.stdout) return result.stderr;
  return `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`;
}

export type EvalAction =
  | { type: "done" }
  | {
      type: "regenerate";
      feedback?: LifecycleFeedback;
      mode?: AgentMode;
      cycleLimit?: number;
      keepResult?: boolean;
    };

export type EvaluatorContext = {
  result?: { text: string };
  observedTools: Set<string>;
  debug: (event: LifecycleEventName, fields?: Record<string, unknown>) => void;
  policy: LifecyclePolicy;
  initialMode: AgentMode;
  mode: AgentMode;
  taskId: string | undefined;
  session: SessionContext;
  workspace: string | undefined;
  request: { message: string; verifyScope?: VerifyScope };
  lifecycleState: LifecycleState;
  currentError?: LifecycleError;
};

export type Evaluator = {
  id: string;
  evaluate: (ctx: EvaluatorContext) => EvalAction;
};

function formatToolRecovery(message: string, recovery: NonNullable<LifecycleError["recovery"]>): string {
  const hints: string[] = [];
  if (recovery.nextTool) hints.push(`Suggested next tool: ${recovery.nextTool}`);
  if (recovery.targetPaths && recovery.targetPaths.length > 0) {
    hints.push(`Suggested paths: ${recovery.targetPaths.join(", ")}`);
  }
  if (hints.length === 0) return message;
  return [message, ...hints].join("\n");
}

function hasRecoveredFromLastEditFileFailure(ctx: EvaluatorContext): boolean {
  const callLog = scopedCallLog(ctx.session, ctx.taskId);
  let lastFailIdx = -1;
  for (let i = callLog.length - 1; i >= 0; i--) {
    const entry = callLog[i];
    if (entry?.toolName === "file-edit" && entry.status === "failed") {
      lastFailIdx = i;
      break;
    }
  }
  if (lastFailIdx === -1) return false;
  return callLog
    .slice(lastFailIdx + 1)
    .some((entry) => WRITE_TOOL_SET.has(entry.toolName) && entry.status !== "failed");
}

function writePathsForCurrentTask(ctx: EvaluatorContext): string[] {
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

function renderTaskBoundary(paths: string[]): string | undefined {
  if (paths.length === 0) return undefined;
  return ["Task boundary:", ...paths.map((path) => `- ${path}`)].join("\n");
}

function targetedValidationTargetsAfterLastWrite(ctx: EvaluatorContext): string[] {
  const calls = scopedCallLog(ctx.session, ctx.taskId);
  let lastWriteIdx = -1;
  for (let i = calls.length - 1; i >= 0; i--) {
    if (WRITE_TOOL_SET.has(calls[i]?.toolName ?? "")) {
      lastWriteIdx = i;
      break;
    }
  }

  const targets = new Set<string>();
  for (const entry of calls.slice(lastWriteIdx + 1)) {
    if (entry.toolName !== "test-run") continue;
    const files = Array.isArray(entry.args.files) ? entry.args.files : [];
    for (const value of files) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed.length > 0) targets.add(trimmed);
    }
  }
  return Array.from(targets);
}

function renderExistingValidation(ctx: EvaluatorContext): string | undefined {
  const files = targetedValidationTargetsAfterLastWrite(ctx);
  if (files.length === 0) return undefined;
  return ["Targeted validation already ran after the last edit:", ...files.map((path) => `- ${path}`)].join("\n");
}

function joinDetails(...parts: Array<string | undefined>): string | undefined {
  const present = parts.filter((part): part is string => Boolean(part && part.length > 0));
  if (present.length === 0) return undefined;
  return present.join("\n\n");
}

type BoundedLiteralReplacement = {
  path: string;
  literal: string;
};

function extractSingleTargetPath(message: string): string | undefined {
  const matches = message.matchAll(/(?:^|[\s(,])((?:\.{0,2}\/)?[A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+)/g);
  const unique = new Set<string>();
  for (const match of matches) {
    const value = match[1]?.trim();
    if (!value) continue;
    unique.add(normalizePath(value));
    if (unique.size > 1) return undefined;
  }
  return unique.size === 1 ? Array.from(unique)[0] : undefined;
}

function boundedLiteralReplacementForRequest(message: string): BoundedLiteralReplacement | undefined {
  if (!/\b(each|every|all)\b/i.test(message)) return undefined;
  const path = extractSingleTargetPath(message);
  if (!path) return undefined;
  const literalMatch = message.match(
    /replace\s+(?:each|every|all(?:\s+eligible\s+occurrences?)?(?:\s+of)?)\s+([`'"])(.+?)\1/i,
  );
  const literal = literalMatch?.[2]?.trim();
  if (!literal) return undefined;
  return { path, literal };
}

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

export const boundedLiteralCompletenessEvaluator: Evaluator = {
  id: "bounded-literal-completeness",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.mode !== "work" || !ctx.workspace) return { type: "done" };
    const replacement = boundedLiteralReplacementForRequest(ctx.request.message);
    if (!replacement) return { type: "done" };
    if (!writePathsForCurrentTask(ctx).includes(replacement.path)) return { type: "done" };

    let content: string;
    try {
      content = readFileSync(`${ctx.workspace}/${replacement.path}`, "utf8");
    } catch {
      return { type: "done" };
    }

    const remaining = countOccurrences(content, replacement.literal);
    ctx.debug("lifecycle.eval.bounded_literal_completeness", {
      path: replacement.path,
      literal: replacement.literal,
      remaining,
    });
    if (remaining === 0) return { type: "done" };

    return {
      type: "regenerate",
      feedback: {
        source: "completeness",
        mode: "work",
        summary: `The requested literal replacement in "${replacement.path}" is incomplete.`,
        details: `The file still contains ${remaining} occurrence${remaining === 1 ? "" : "s"} of \`${replacement.literal}\`.`,
        instruction: "Finish the requested bounded replacement in that file before stopping.",
      },
    };
  },
};

export const formatEvaluator: Evaluator = {
  id: "format",
  evaluate(ctx) {
    if (ctx.mode !== "work" || !ctx.workspace) return { type: "done" };
    if (!ctx.policy.formatCommand) return { type: "done" };
    const paths = writePathsForCurrentTask(ctx);
    if (paths.length === 0) return { type: "done" };
    runCommandWithFiles(ctx.workspace, ctx.policy.formatCommand, paths);
    ctx.debug("lifecycle.eval.format", { files: paths.length });
    return { type: "done" };
  },
};

export const lintEvaluator: Evaluator = {
  id: "lint",
  evaluate(ctx) {
    if (ctx.mode !== "work" || !ctx.workspace) return { type: "done" };
    if (!ctx.policy.lintCommand) return { type: "done" };
    const paths = writePathsForCurrentTask(ctx);
    if (paths.length === 0) return { type: "done" };
    const result = runCommandWithFiles(ctx.workspace, ctx.policy.lintCommand, paths);
    if (!result.hasErrors) return { type: "done" };
    ctx.debug("lifecycle.eval.lint", { files: paths.length });
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
  },
};

export const guardRecoveryEvaluator: Evaluator = {
  id: "guard-recovery",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.currentError?.category !== "guard-blocked") return { type: "done" };
    const hasPendingFeedback = ctx.lifecycleState.feedback.some(
      (feedback) => feedback.source === "guard" && feedback.mode === ctx.mode,
    );
    if (!hasPendingFeedback) return { type: "done" };
    ctx.debug("lifecycle.eval.guard_recovery", { mode: ctx.mode, error: ctx.currentError.message });
    return { type: "regenerate" };
  },
};

export const repeatedFailureEvaluator: Evaluator = {
  id: "repeated-failure",
  evaluate(ctx) {
    const repeatedFailure = ctx.lifecycleState.repeatedFailure;
    if (!ctx.result || !ctx.currentError || !repeatedFailure) return { type: "done" };
    if (ctx.currentError.category === "guard-blocked") return { type: "done" };
    if (repeatedFailure.count < 2) return { type: "done" };
    if (repeatedFailure.status === "surfaced") return { type: "done" };

    repeatedFailure.status = "surfaced";
    ctx.debug("lifecycle.eval.repeated_failure", {
      signature: repeatedFailure.signature,
      count: repeatedFailure.count,
      code: ctx.currentError.code ?? null,
      category: ctx.currentError.category ?? null,
      tool: ctx.currentError.tool ?? null,
    });

    return {
      type: "regenerate",
      feedback: {
        source: "repeated-failure",
        mode: ctx.mode,
        summary: "The same runtime failure has repeated.",
        details: ctx.currentError.message,
        instruction: "Do not retry the same failing move. Change approach before continuing.",
      },
    };
  },
};

export const verifyEvaluator: Evaluator = {
  id: "verify-cycle",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.request.verifyScope === "none") return { type: "done" };

    if (ctx.mode !== "verify") {
      const usedWriteTools = WRITE_TOOLS.some((tool) => ctx.observedTools.has(tool));
      const verified = haveChangesBeenVerified(ctx.session, ctx.taskId);
      ctx.debug("lifecycle.eval.verify_cycle", {
        used_write_tools: usedWriteTools,
        verified,
        verify_scope: ctx.request.verifyScope ?? null,
      });
      if (!(ctx.initialMode === "work" && usedWriteTools && !verified)) return { type: "done" };
      const writePaths = writePathsForCurrentTask(ctx);

      return {
        type: "regenerate",
        feedback: {
          source: "verify",
          mode: "verify",
          summary: "Review the changes for correctness.",
          details: joinDetails(renderTaskBoundary(writePaths), renderExistingValidation(ctx)),
          instruction:
            "Review only the edited files above. Start with one code-scan call over those paths. Do not reread those edited files after the scan. Reuse any targeted test evidence that already ran after the last edit, and do not rerun the same test files in verify mode. If code-scan is insufficient, use test-run only for different changed tests or direct source counterparts.",
        },
        mode: "verify",
        cycleLimit: ctx.policy.verifyMaxSteps,
        keepResult: true,
      };
    }

    return { type: "done" };
  },
};

export const toolRecoveryEvaluator: Evaluator = {
  id: "tool-recovery",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.mode !== "work") return { type: "done" };
    const currentError = ctx.currentError;
    if (!currentError) return { type: "done" };
    const recovery = currentError.recovery;
    if (!recovery) return { type: "done" };
    if (
      recovery.tool === "file-edit" &&
      recovery.kind === "disambiguate-match" &&
      hasRecoveredFromLastEditFileFailure(ctx)
    ) {
      return { type: "done" };
    }

    ctx.debug("lifecycle.eval.tool_recovery", {
      error: currentError.message,
      recovery_tool: recovery.tool,
      recovery_kind: recovery.kind,
    });
    return {
      type: "regenerate",
      feedback: {
        source: "tool-recovery",
        mode: "work",
        summary: recovery.summary,
        details: formatToolRecovery(currentError.message, recovery),
        instruction: recovery.instruction,
      },
    };
  },
};
