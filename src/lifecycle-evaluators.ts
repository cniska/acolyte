import type { AgentMode } from "./agent-contract";
import { createModeInstructions } from "./agent-instructions";
import type { VerifyScope } from "./api";
import type { ErrorCategory } from "./error-handling";
import { taskScopedCallLog } from "./lifecycle-contract";
import type { LifecycleEventName } from "./lifecycle-events";
import type { LifecyclePolicy } from "./lifecycle-policy";
import { extractReadPaths } from "./tool-arg-paths";
import { WRITE_TOOL_SET, WRITE_TOOLS } from "./tool-groups";
import type { SessionContext } from "./tool-guards";

export type EvalAction =
  | { type: "done" }
  | {
      type: "regenerate";
      prompt: string;
      mode?: AgentMode;
      cycleLimit?: number;
      timeoutMs?: number;
      keepResult?: boolean;
    };

export type EvaluatorContext = {
  result?: { text: string };
  observedTools: Set<string>;
  debug: (event: LifecycleEventName, fields?: Record<string, unknown>) => void;
  agentInput: string;
  policy: LifecyclePolicy;
  classifiedMode: AgentMode;
  mode: AgentMode;
  taskId: string | undefined;
  session: SessionContext;
  workspace: string | undefined;
  request: { message: string; verifyScope?: VerifyScope };
  sawEditFileMultiMatchError: boolean;
  lastError?: string;
  lastErrorCategory?: ErrorCategory;
};

export type Evaluator = {
  id: string;
  evaluate: (ctx: EvaluatorContext) => EvalAction;
};

function findLastEditFilePath(ctx: EvaluatorContext): string | undefined {
  const callLog = taskScopedCallLog(ctx.session, ctx.taskId);
  for (let i = callLog.length - 1; i >= 0; i -= 1) {
    const entry = callLog[i];
    if (entry?.toolName !== "edit-file") continue;
    const path = entry.args?.path;
    if (typeof path === "string" && path.trim().length > 0) return path.trim();
  }
  return undefined;
}

function writePathsForCurrentTask(ctx: EvaluatorContext): string[] {
  const out = new Set<string>();
  for (const entry of taskScopedCallLog(ctx.session, ctx.taskId)) {
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
  for (const entry of taskScopedCallLog(ctx.session, ctx.taskId)) {
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

export const timeoutRecovery: Evaluator = {
  id: "timeout-recovery",
  evaluate(ctx) {
    if (!ctx.lastError) return { type: "done" };
    if (ctx.lastErrorCategory !== "timeout") return { type: "done" };
    return {
      type: "regenerate",
      prompt: ctx.agentInput,
      cycleLimit: ctx.policy.timeoutRecoveryMaxSteps,
      timeoutMs: ctx.policy.timeoutRecoveryTimeoutMs,
    };
  },
};

export const verifyCycle: Evaluator = {
  id: "verify-cycle",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };

    // Work → Verify: trigger verify when write tools were used
    if (ctx.mode !== "verify") {
      const usedWriteTools = WRITE_TOOLS.some((tool) => ctx.observedTools.has(tool));
      if (ctx.classifiedMode === "work" && usedWriteTools && !ctx.session.flags.verifyRan) {
        return {
          type: "regenerate",
          prompt: scopedVerifyPrompt(ctx),
          mode: "verify",
          cycleLimit: ctx.policy.verifyMaxSteps,
          keepResult: true,
        };
      }
      return { type: "done" };
    }

    // Verify → Work: return to work when verify found issues
    if (!ctx.lastError && !ctx.session.flags.verifyRan) return { type: "done" };
    if (!ctx.lastError) return { type: "done" };
    ctx.debug("lifecycle.eval.verify_failure", { text_chars: ctx.result.text.length });
    return {
      type: "regenerate",
      prompt: `${ctx.agentInput}\n\nVerification found issues:\n${ctx.result.text}\n\nFix the issues above, then stop.`,
      mode: "work",
    };
  },
};

export const modeTransition: Evaluator = {
  id: "mode-transition",
  evaluate(ctx) {
    if (!ctx.policy.planPhase) return { type: "done" };
    if (!ctx.result) return { type: "done" };

    if (ctx.mode === "plan") {
      // Plan → Work: plan produced text and used tools, ready to implement
      if (!ctx.result.text.trim()) return { type: "done" };
      if (ctx.observedTools.size === 0) return { type: "done" };
      return {
        type: "regenerate",
        prompt: `${ctx.agentInput}\n\nYour analysis above is complete. Now implement the changes.`,
        mode: "work",
        keepResult: true,
      };
    }

    if (ctx.mode === "work") {
      // Work → Plan: work failed without writing anything, re-analyze
      if (!ctx.lastError) return { type: "done" };
      const usedWriteTools = WRITE_TOOLS.some((t) => ctx.observedTools.has(t));
      if (usedWriteTools) return { type: "done" };
      return {
        type: "regenerate",
        prompt: `${ctx.agentInput}\n\nWork failed without writing changes (last error: ${ctx.lastError}). Re-analyze the problem.`,
        mode: "plan",
        cycleLimit: ctx.policy.planMaxSteps,
      };
    }

    return { type: "done" };
  },
};

export const multiMatchEditEvaluator: Evaluator = {
  id: "multi-match-edit-evaluator",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.classifiedMode !== "work") return { type: "done" };
    if (!ctx.sawEditFileMultiMatchError) return { type: "done" };
    if (!ctx.observedTools.has("edit-file")) return { type: "done" };
    if (ctx.observedTools.has("edit-code")) return { type: "done" };

    const targetPath = findLastEditFilePath(ctx);
    ctx.debug("lifecycle.eval.multi_match_edit_regenerate", {
      error: ctx.lastError ?? "multi_match_seen",
      target_path: targetPath ?? null,
    });
    return {
      type: "regenerate",
      prompt:
        `${ctx.agentInput}\n\n` +
        "Your previous edit-file call matched multiple locations. " +
        "For this task, your next tool call must be edit-code (not edit-file). " +
        (targetPath
          ? `Use path '${targetPath}' for edit-code and do not use '.' or directory paths. `
          : "Use a concrete file path for edit-code and do not use '.' or directory paths. ") +
        "Do not run additional find/search/read calls unless edit-code fails. " +
        "After applying edit-code changes, run verify.",
    };
  },
};
