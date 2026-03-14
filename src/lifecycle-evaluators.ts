import type { AgentMode } from "./agent-contract";
import { createModeInstructions } from "./agent-instructions";
import type { VerifyScope } from "./api";
import type { LifecycleError, LifecycleEventName, LifecycleFeedback, VerifyOutcome } from "./lifecycle-contract";
import type { LifecyclePolicy } from "./lifecycle-policy";
import { lintFiles } from "./lint-reflection";
import { extractReadPaths } from "./tool-arg-paths";
import { haveChangesBeenVerified, type SessionContext, scopedCallLog } from "./tool-guards";
import { WRITE_TOOL_SET, WRITE_TOOLS } from "./tool-registry";

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
  lifecycleState: {
    feedback: LifecycleFeedback[];
    verifyOutcome?: VerifyOutcome;
    repeatedFailure?: { signature: string; count: number; status: "pending" | "surfaced" };
  };
  currentError?: LifecycleError;
};

export type Evaluator = {
  id: string;
  evaluate: (ctx: EvaluatorContext) => EvalAction;
};

function hasRecoveredFromLastEditFileFailure(ctx: EvaluatorContext): boolean {
  const callLog = scopedCallLog(ctx.session, ctx.taskId);
  let lastFailIdx = -1;
  for (let i = callLog.length - 1; i >= 0; i--) {
    const entry = callLog[i];
    if (entry?.toolName === "edit-file" && entry.status === "failed") {
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

function readPathsForCurrentTask(ctx: EvaluatorContext): string[] {
  const out = new Set<string>();
  for (const entry of scopedCallLog(ctx.session, ctx.taskId)) {
    if (entry.toolName === "read-file") {
      for (const key of extractReadPaths(entry.args)) out.add(key);
      continue;
    }
    if (entry.toolName === "scan-code") {
      const paths = entry.args?.paths;
      if (!Array.isArray(paths)) continue;
      for (const value of paths) {
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        if (trimmed.length > 0) out.add(trimmed);
      }
    }
  }
  return Array.from(out);
}

function scopedVerifyPrompt(ctx: EvaluatorContext): string {
  const base = createModeInstructions("verify", ctx.workspace);
  if (ctx.request.verifyScope === "global") return base;
  const paths = writePathsForCurrentTask(ctx);
  if (paths.length === 0) return base;
  const supportingPaths = readPathsForCurrentTask(ctx).filter((path) => !paths.includes(path));
  return [
    base,
    "",
    "Task boundary:",
    `Primary scope (changed in this task, ${paths.length}):`,
    ...paths.map((path) => `- ${path}`),
    ...(supportingPaths.length > 0
      ? [
          "",
          `Allowed supporting reads (already read this task, ${supportingPaths.length}):`,
          ...supportingPaths.map((path) => `- ${path}`),
        ]
      : []),
    "Do not review unrelated repository changes from earlier tasks.",
  ].join("\n");
}

export const lintEvaluator: Evaluator = {
  id: "lint",
  evaluate(ctx) {
    if (ctx.mode !== "work" || !ctx.workspace) return { type: "done" };
    if (!ctx.policy.lintCommand) return { type: "done" };
    const paths = writePathsForCurrentTask(ctx);
    if (paths.length === 0) return { type: "done" };
    const result = lintFiles(ctx.workspace, paths, ctx.policy.lintCommand);
    if (!result.hasErrors) return { type: "done" };
    ctx.debug("lifecycle.eval.lint", { files: paths.length });
    return {
      type: "regenerate",
      feedback: {
        source: "lint",
        mode: "work",
        summary: "Lint errors detected in files you edited.",
        details: result.output,
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

export const verifyCycle: Evaluator = {
  id: "verify-cycle",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.request.verifyScope === "none") return { type: "done" };

    // Work → Verify: trigger verify when write tools were used
    if (ctx.mode !== "verify") {
      const usedWriteTools = WRITE_TOOLS.some((tool) => ctx.observedTools.has(tool));
      if (ctx.initialMode === "work" && usedWriteTools && !haveChangesBeenVerified(ctx.session, ctx.taskId)) {
        return {
          type: "regenerate",
          feedback: {
            source: "verify",
            mode: "verify",
            summary: "Run verification for the current task scope.",
            details: scopedVerifyPrompt(ctx),
          },
          mode: "verify",
          cycleLimit: ctx.policy.verifyMaxSteps,
          keepResult: true,
        };
      }
      return { type: "done" };
    }

    // Verify → Work: use the verifier's structured outcome, not the restored work-mode result.
    const verifyOutcome = ctx.lifecycleState.verifyOutcome;
    if (!verifyOutcome?.error) return { type: "done" };
    ctx.debug("lifecycle.eval.verify_failure", { text_chars: verifyOutcome.text.length });
    return {
      type: "regenerate",
      feedback: {
        source: "verify",
        mode: "work",
        summary: "Verification found issues.",
        details: verifyOutcome.text,
        instruction: "Fix the issues above, then stop.",
      },
      mode: "work",
    };
  },
};

export const editFileRecoveryEvaluator: Evaluator = {
  id: "edit-file-recovery",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.initialMode !== "work") return { type: "done" };
    if (ctx.currentError?.tool !== "edit-file") return { type: "done" };
    const recovery = ctx.currentError.recovery;
    if (!recovery || recovery.tool !== "edit-file") return { type: "done" };
    if (recovery.kind === "disambiguate-match" && hasRecoveredFromLastEditFileFailure(ctx)) return { type: "done" };

    ctx.debug("lifecycle.eval.edit_file_recovery", {
      error: ctx.currentError.message,
      recovery_kind: recovery.kind,
    });
    return {
      type: "regenerate",
      feedback: {
        source: "edit-file",
        mode: "work",
        summary: recovery.summary,
        details: ctx.currentError.message,
        instruction: recovery.instruction,
      },
    };
  },
};
