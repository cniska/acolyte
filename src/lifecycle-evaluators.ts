import type { AgentMode } from "./agent-contract";
import { createModeInstructions } from "./agent-instructions";
import type { VerifyScope } from "./api";
import {
  haveChangesBeenVerified,
  type LifecycleError,
  type LifecycleEventName,
  type VerifyOutcome,
  taskScopedCallLog,
} from "./lifecycle-contract";
import type { LifecyclePolicy } from "./lifecycle-policy";
import { lintFiles } from "./lint-reflection";
import { extractReadPaths } from "./tool-arg-paths";
import type { SessionContext } from "./tool-guards";
import { WRITE_TOOL_SET, WRITE_TOOLS } from "./tool-registry";

export type EvalAction =
  | { type: "done" }
  | {
      type: "regenerate";
      prompt: string;
      mode?: AgentMode;
      cycleLimit?: number;
      keepResult?: boolean;
    };

export type EvaluatorContext = {
  result?: { text: string };
  observedTools: Set<string>;
  debug: (event: LifecycleEventName, fields?: Record<string, unknown>) => void;
  agentInput: string;
  policy: LifecyclePolicy;
  initialMode: AgentMode;
  mode: AgentMode;
  taskId: string | undefined;
  session: SessionContext;
  workspace: string | undefined;
  request: { message: string; verifyScope?: VerifyScope };
  sawEditFileMultiMatchError: boolean;
  lastVerifyOutcome?: VerifyOutcome;
  currentError?: LifecycleError;
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
      prompt: [
        ctx.agentInput,
        "",
        "Lint errors detected in files you edited:",
        result.output,
        "",
        "If the project has an auto-fix command, run it first. Otherwise fix the errors manually, then stop.",
      ].join("\n"),
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
      if (ctx.initialMode === "work" && usedWriteTools && !haveChangesBeenVerified(ctx.session, ctx.taskId)) {
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

    // Verify → Work: use the verifier's structured outcome, not the restored work-mode result.
    const verifyOutcome = ctx.lastVerifyOutcome;
    if (!verifyOutcome?.error) return { type: "done" };
    ctx.debug("lifecycle.eval.verify_failure", { text_chars: verifyOutcome.text.length });
    return {
      type: "regenerate",
      prompt: `${ctx.agentInput}\n\nVerification found issues:\n${verifyOutcome.text}\n\nFix the issues above, then stop.`,
      mode: "work",
    };
  },
};

export const multiMatchEditEvaluator: Evaluator = {
  id: "multi-match-edit-evaluator",
  evaluate(ctx) {
    if (!ctx.result) return { type: "done" };
    if (ctx.initialMode !== "work") return { type: "done" };
    if (!ctx.sawEditFileMultiMatchError) return { type: "done" };
    if (!ctx.observedTools.has("edit-file")) return { type: "done" };
    if (ctx.observedTools.has("edit-code")) return { type: "done" };

    const targetPath = findLastEditFilePath(ctx);
    ctx.debug("lifecycle.eval.multi_match_edit_regenerate", {
      error: ctx.currentError?.message ?? "multi_match_seen",
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
