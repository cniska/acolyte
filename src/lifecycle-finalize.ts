import { estimateTokens } from "./agent-input";
import type { ChatResponse } from "./api";
import { t } from "./i18n";
import { promptUsageTotalTokens, type RunContext } from "./lifecycle-contract";
import { DISCOVERY_TOOL_SET, READ_TOOL_SET, SEARCH_TOOL_SET, WRITE_TOOL_SET } from "./tool-registry";
import { scopedCallLog } from "./tool-session";

const SIGNAL_OUTPUT_KEYS = {
  done: "agent.output.done",
  noop: "agent.output.no_changes_needed",
} as const;

function signalOutput(ctx: RunContext): string {
  if (ctx.acceptedSignal === "blocked") {
    return ctx.result?.signalReason?.trim() ?? "";
  }

  if (ctx.acceptedSignal === "done" || ctx.acceptedSignal === "noop") {
    return t(SIGNAL_OUTPUT_KEYS[ctx.acceptedSignal]);
  }

  return "";
}

export function phaseFinalize(ctx: RunContext): ChatResponse {
  const unresolvedToolError = ctx.currentError?.source === "tool-error" || ctx.currentError?.source === "tool-result";
  const blockingError = unresolvedToolError || ctx.currentError?.blocksCompletion === true;
  // A blocking error is surfaced through `error` alone; `output` keeps the model's own
  // text (or a neutral fallback) so the reason is never rendered twice.
  const rawOutput = (ctx.result?.text ?? "").trim() || signalOutput(ctx);
  const output =
    rawOutput.length > 0
      ? rawOutput
      : blockingError
        ? // On a blocking error the status/error row is the authoritative output; emit
          // no fallback so it never renders a placeholder bubble beside the reason.
          ""
        : ctx.observedTools.size > 0
          ? t("agent.output.no_response_after_tools")
          : t("agent.output.no_output");

  const { promptUsage } = ctx;
  const promptInputTokens = promptUsageTotalTokens(promptUsage);
  const inputTokens = Math.max(ctx.inputTokensAccum, promptInputTokens);
  const outputTokens = ctx.outputTokensAccum || estimateTokens(output);

  const callLog = scopedCallLog(ctx.session, ctx.taskId);
  const totalToolCalls = callLog.length;
  // Recall probes search memory/history, not the codebase (session-search is category
  // "search", so it would otherwise land in the code-search and discovery tallies);
  // keep them off those axes so read/search/discovery stay a clean over-exploration signal.
  const isRecallProbe = (toolName: string) => toolName === "memory-search" || toolName === "session-search";
  const isCodeDiscovery = (entry: { toolName: string }) =>
    DISCOVERY_TOOL_SET.has(entry.toolName) && !isRecallProbe(entry.toolName);
  const readCalls = callLog.filter((entry) => READ_TOOL_SET.has(entry.toolName)).length;
  const searchCalls = callLog.filter(
    (entry) => SEARCH_TOOL_SET.has(entry.toolName) && !isRecallProbe(entry.toolName),
  ).length;
  const writeCalls = callLog.filter((entry) => WRITE_TOOL_SET.has(entry.toolName)).length;
  const memorySearchCalls = callLog.filter((entry) => entry.toolName === "memory-search").length;
  const sessionSearchCalls = callLog.filter((entry) => entry.toolName === "session-search").length;
  const firstWriteIndex = callLog.findIndex((entry) => WRITE_TOOL_SET.has(entry.toolName));
  const preWriteDiscoveryCalls =
    firstWriteIndex >= 0
      ? callLog.slice(0, firstWriteIndex).filter(isCodeDiscovery).length
      : callLog.filter(isCodeDiscovery).length;

  ctx.debug("lifecycle.summary", {
    task_id: ctx.taskId ?? null,
    model: ctx.model,
    model_calls: ctx.modelCallCount,
    tool_calls: totalToolCalls,
    unique_tool_count: ctx.observedTools.size,
    tools: Array.from(ctx.observedTools).join(","),
    has_error: Boolean(ctx.currentError),
    output_chars: output.length,

    read_calls: readCalls,
    search_calls: searchCalls,
    write_calls: writeCalls,
    memory_search_calls: memorySearchCalls,
    session_search_calls: sessionSearchCalls,
    pre_write_discovery_calls: preWriteDiscoveryCalls,
    lifecycle_signal: ctx.acceptedSignal ?? null,
    budget_blocked: ctx.errorStats["budget-exhausted"] > 0,
    active_skills: ctx.request.activeSkills?.map((s) => s.name) ?? null,
    last_error_code: ctx.currentError?.code ?? null,
    last_error_category: ctx.currentError?.category ?? null,
    timeout_error_count: ctx.errorStats.timeout,
    file_not_found_error_count: ctx.errorStats["file-not-found"],
    budget_exhausted_count: ctx.errorStats["budget-exhausted"],
    other_error_count: ctx.errorStats.other,
  });

  return {
    state: blockingError || ctx.acceptedSignal === "blocked" ? "awaiting-input" : "done",
    model: ctx.model,
    output,
    ...(ctx.currentError ? { error: ctx.currentError.message } : {}),
    toolCalls: callLog.map((entry) => entry.toolName),
    modelCalls: ctx.modelCallCount,
    ...(ctx.session.activeSkills?.length ? { activeSkills: ctx.session.activeSkills } : {}),
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      inputBudgetTokens: ctx.promptUsage.inputBudgetTokens,
    },
    promptBreakdown: {
      budgetTokens: promptUsage.inputBudgetTokens,
      usedTokens: inputTokens,
      systemTokens: promptUsage.systemPromptTokens,
      toolTokens: promptUsage.toolTokens,
      skillTokens: promptUsage.skillTokens,
      memoryTokens: promptUsage.memoryTokens,
      messageTokens: promptUsage.messageTokens,
    },
  };
}
