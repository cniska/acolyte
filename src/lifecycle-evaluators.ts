import { createModeInstructions, isPlanLikeOutput } from "./agent";
import type { AgentMode } from "./agent-modes";
import type { VerifyScope } from "./api";
import { type ErrorCategory, isFileNotFoundSignal } from "./error-handling";
import type { LifecycleEventName } from "./lifecycle-events";
import type { LifecyclePolicy } from "./lifecycle-policy";
import { DISCOVERY_TOOL_SET, WRITE_TOOL_SET, WRITE_TOOLS } from "./tool-groups";
import type { SessionContext } from "./tool-guards";

export type EvalAction =
  | { type: "done" }
  | {
      type: "regenerate";
      prompt: string;
      mode?: AgentMode;
      maxSteps?: number;
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
  request: { message: string; skipAutoVerify?: boolean; verifyScope?: VerifyScope };
  sawEditFileMultiMatchError: boolean;
  lastError?: string;
  lastErrorCategory?: ErrorCategory;
};

function taskScopedCallLog(ctx: EvaluatorContext) {
  if (!ctx.taskId) return ctx.session.callLog;
  return ctx.session.callLog.filter((entry) => entry.taskId === ctx.taskId);
}

export type Evaluator = {
  id: string;
  evaluate: (ctx: EvaluatorContext) => EvalAction;
};

function hasStrongWriteIntent(text: string): boolean {
  return /\b(edit|fix|implement|add|create|update|refactor|rename|change|delete|remove|migrate|convert)\b/i.test(text);
}

function readPathKeys(args: Record<string, unknown>): string[] {
  const paths = args.paths;
  if (!Array.isArray(paths)) return [];
  const out: string[] = [];
  for (const entry of paths) {
    if (!entry || typeof entry !== "object") continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path === "string" && path.trim().length > 0) out.push(path.trim());
  }
  return out;
}

function findLastEditFilePath(ctx: EvaluatorContext): string | undefined {
  const callLog = taskScopedCallLog(ctx);
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
  for (const entry of taskScopedCallLog(ctx)) {
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
  for (const entry of taskScopedCallLog(ctx)) {
    if (entry.toolName === "read-file") {
      for (const key of readPathKeys(entry.args)) out.add(key);
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

export const planDetector: Evaluator = {
  id: "plan-detector",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (isPlanLikeOutput(ctx.result.text.trim()) && ctx.observedTools.size === 0) {
      ctx.debug("lifecycle.eval.plan_detected", { text_chars: ctx.result.text.trim().length });
      return {
        type: "regenerate",
        prompt: `${ctx.agentInput}\n\nExecute the task directly using tools. Do not describe a plan or ask for confirmation.`,
      };
    }
    return { type: "done" };
  },
};

export const timeoutRecovery: Evaluator = {
  id: "timeout-recovery",
  evaluate(ctx) {
    if (!ctx.lastError) return { type: "done" };
    if (ctx.lastErrorCategory !== "timeout") return { type: "done" };
    return {
      type: "regenerate",
      prompt: ctx.agentInput,
      maxSteps: ctx.policy.timeoutRecoveryMaxSteps,
      timeoutMs: ctx.policy.timeoutRecoveryTimeoutMs,
    };
  },
};

export const autoVerifier: Evaluator = {
  id: "auto-verifier",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.request.skipAutoVerify) return { type: "done" };
    const usedWriteTools = WRITE_TOOLS.some((tool) => ctx.observedTools.has(tool));
    if (ctx.classifiedMode === "work" && usedWriteTools && !ctx.session.flags.verifyRan) {
      return {
        type: "regenerate",
        prompt: scopedVerifyPrompt(ctx),
        mode: "verify",
        maxSteps: ctx.policy.verifyMaxSteps,
        keepResult: true,
      };
    }
    return { type: "done" };
  },
};

export const verifyFailure: Evaluator = {
  id: "verify-failure",
  evaluate(ctx) {
    if (ctx.mode !== "verify") return { type: "done" };
    if (!ctx.result) return { type: "done" };
    const text = ctx.result.text.trim().toLowerCase();
    if (text.length === 0) return { type: "done" };
    const hasVerifyRunSignal = Boolean(ctx.session.flags.verifyRan);
    if (!ctx.lastError && !hasVerifyRunSignal) return { type: "done" };
    if (/\b(no|zero|0)\s+(errors?|issues?|failures?)\b/.test(text)) return { type: "done" };
    if (/\b(all checks passed|verify passed|verification passed|passed cleanly|looks good|clean)\b/.test(text))
      return { type: "done" };
    const hasIssues =
      ctx.lastError != null ||
      /\b(error|failed?|issue|broken|missing|undefined|unresolved|cannot find|not found)\b/.test(text);
    if (!hasIssues) return { type: "done" };
    ctx.debug("lifecycle.eval.verify_failure", { text_chars: ctx.result.text.length });
    return {
      type: "regenerate",
      prompt: `${ctx.agentInput}\n\nVerification found issues:\n${ctx.result.text}\n\nFix the issues above, then stop.`,
      mode: "work",
    };
  },
};

export const efficiencyEvaluator: Evaluator = {
  id: "efficiency-evaluator",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.classifiedMode !== "work") return { type: "done" };
    if (!hasStrongWriteIntent(ctx.request.message)) return { type: "done" };

    const callLog = taskScopedCallLog(ctx);
    const firstWriteIndex = callLog.findIndex((entry) => WRITE_TOOL_SET.has(entry.toolName));
    if (firstWriteIndex >= 0) return { type: "done" };
    const fileNotFoundOutcome =
      (ctx.lastError ? isFileNotFoundSignal(ctx.lastError) : false) || isFileNotFoundSignal(ctx.result.text);
    if (fileNotFoundOutcome) return { type: "done" };

    const discoveryCalls = callLog.filter((entry) => DISCOVERY_TOOL_SET.has(entry.toolName)).length;
    let repeatedReadCalls = 0;
    const readPathSeen = new Set<string>();
    for (const entry of callLog) {
      if (entry.toolName !== "read-file") continue;
      const keys = readPathKeys(entry.args);
      const key = keys.join("|");
      if (!key) continue;
      if (readPathSeen.has(key)) {
        repeatedReadCalls += 1;
      } else {
        readPathSeen.add(key);
      }
    }
    if (discoveryCalls < 3 && repeatedReadCalls < 2) return { type: "done" };

    ctx.debug("lifecycle.eval.efficiency_regenerate", {
      discovery_calls: discoveryCalls,
      repeated_read_calls: repeatedReadCalls,
    });
    return {
      type: "regenerate",
      prompt:
        `${ctx.agentInput}\n\n` +
        "You already have enough context. Do not run find/search/read again unless absolutely required. " +
        "Proceed directly with file edits, then run verify.",
    };
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
