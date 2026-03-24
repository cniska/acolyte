import type { AgentMode } from "./agent-contract";
import type { VerifyScope } from "./api";
import type { LifecycleError, LifecycleEventName, LifecycleFeedback, LifecycleState } from "./lifecycle-contract";
import type { LifecyclePolicy } from "./lifecycle-policy";
import { haveChangesBeenVerified, type SessionContext, scopedCallLog } from "./tool-guards";
import { WRITE_TOOL_SET, WRITE_TOOLS } from "./tool-registry";
import { formatWorkspaceCommand, runCommand, runCommandWithFiles } from "./workspace-profile";

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

export const verifyEvaluator: Evaluator = {
  id: "verify-cycle",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.request.verifyScope === "none") return { type: "done" };

    // Work → Verify: trigger verify when write tools were used
    if (ctx.mode !== "verify") {
      const usedWriteTools = WRITE_TOOLS.some((tool) => ctx.observedTools.has(tool));
      const verified = haveChangesBeenVerified(ctx.session, ctx.taskId);
      ctx.debug("lifecycle.eval.verify_cycle", {
        used_write_tools: usedWriteTools,
        verified,
        verify_scope: ctx.request.verifyScope ?? null,
      });
      if (!(ctx.initialMode === "work" && usedWriteTools && !verified)) return { type: "done" };

      if (!ctx.workspace || !ctx.policy.verifyCommand) return { type: "done" };

      return {
        type: "regenerate",
        feedback: {
          source: "verify",
          mode: "verify",
          summary: "Run verification for the current task scope.",
          details: `Run: ${formatWorkspaceCommand(ctx.policy.verifyCommand)}`,
        },
        mode: "verify",
        cycleLimit: ctx.policy.verifyMaxSteps,
        keepResult: true,
      };
    }

    // Verify → Work: run verify command directly
    if (!ctx.workspace || !ctx.policy.verifyCommand) return { type: "done" };

    const result = runCommand(ctx.workspace, ctx.policy.verifyCommand);
    ctx.debug("lifecycle.eval.verify_command", {
      command: formatWorkspaceCommand(ctx.policy.verifyCommand),
      has_errors: result.hasErrors,
    });
    if (!result.hasErrors) return { type: "done" };
    return {
      type: "regenerate",
      feedback: {
        source: "verify",
        mode: "work",
        summary: "Verification failed.",
        details: result.output,
        instruction:
          "Fix failures related to files you changed. If all failures are in files you did not edit, they are pre-existing — signal done.",
      },
      mode: "work",
    };
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
      recovery.tool === "edit-file" &&
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
