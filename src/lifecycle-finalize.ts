import { estimateTokens } from "./agent-input";
import { finalizeAssistantOutput, finalizeReviewOutput } from "./agent-output";
import { countLabel } from "./plural";
import { DISCOVERY_TOOL_SET, READ_TOOL_SET, SEARCH_TOOL_SET, WRITE_TOOL_SET } from "./tool-groups";
import { type RunContext, guardStatsFromSession, taskScopedCallLog } from "./lifecycle-contract";
import type { ChatResponse } from "./api";

function isReviewRequest(text: string): boolean {
  return /\breview\b/i.test(text);
}

export function phaseFinalize(ctx: RunContext): ChatResponse {
  const rawOutput = ctx.result?.text.trim() ?? "";
  const output = isReviewRequest(ctx.request.message)
    ? finalizeReviewOutput(rawOutput, ctx.request.message)
    : finalizeAssistantOutput(rawOutput, ctx.request.message, ctx.observedTools.size, ctx.lastError);

  const completionTokens = estimateTokens(output);
  let budgetWarning: string | undefined;
  if (ctx.promptUsage.promptTruncated) {
    const historyUnit = countLabel(ctx.promptUsage.totalHistoryMessages, "history message", "history messages").replace(
      /^\d+\s+/,
      "",
    );
    budgetWarning =
      `context trimmed (${ctx.promptUsage.includedHistoryMessages}/${ctx.promptUsage.totalHistoryMessages} ` +
      `${historyUnit})`;
  } else if (ctx.promptUsage.promptTokens >= Math.floor(ctx.promptUsage.promptBudgetTokens * 0.9)) {
    budgetWarning = `context near budget (${ctx.promptUsage.promptTokens}/${ctx.promptUsage.promptBudgetTokens} tokens)`;
  }

  const callLog = taskScopedCallLog(ctx.session, ctx.taskId);
  const guardStats = guardStatsFromSession(ctx.session);
  const totalToolCalls = callLog.length;
  const readCalls = callLog.filter((entry) => READ_TOOL_SET.has(entry.toolName)).length;
  const searchCalls = callLog.filter((entry) => SEARCH_TOOL_SET.has(entry.toolName)).length;
  const writeCalls = callLog.filter((entry) => WRITE_TOOL_SET.has(entry.toolName)).length;
  const firstWriteIndex = callLog.findIndex((entry) => WRITE_TOOL_SET.has(entry.toolName));
  const preWriteDiscoveryCalls =
    firstWriteIndex >= 0
      ? callLog.slice(0, firstWriteIndex).filter((entry) => DISCOVERY_TOOL_SET.has(entry.toolName)).length
      : callLog.filter((entry) => DISCOVERY_TOOL_SET.has(entry.toolName)).length;

  ctx.debug("lifecycle.summary", {
    task_id: ctx.taskId ?? null,
    mode: ctx.classifiedMode,
    model: ctx.model,
    model_calls: ctx.modelCallCount,
    tool_calls: totalToolCalls,
    unique_tool_count: ctx.observedTools.size,
    tools: Array.from(ctx.observedTools).join(","),
    has_error: Boolean(ctx.lastError),
    output_chars: output.length,
    budget_warning: budgetWarning ?? null,
    total_tool_calls: totalToolCalls,
    read_calls: readCalls,
    search_calls: searchCalls,
    write_calls: writeCalls,
    pre_write_discovery_calls: preWriteDiscoveryCalls,
    regeneration_count: ctx.regenerationCount,
    regeneration_limit_hit: ctx.regenerationLimitHit,
    guard_blocked_count: guardStats.blocked,
    guard_flag_set_count: guardStats.flagSet,
    last_error_code: ctx.lastErrorCode ?? null,
    last_error_category: ctx.lastErrorCategory ?? null,
    timeout_error_count: ctx.errorStats.timeout,
    file_not_found_error_count: ctx.errorStats["file-not-found"],
    guard_blocked_error_count: ctx.errorStats["guard-blocked"],
    other_error_count: ctx.errorStats.other,
  });

  return {
    model: ctx.model,
    output,
    toolCalls: callLog.map((entry) => entry.toolName),
    modelCalls: ctx.modelCallCount,
    usage: {
      promptTokens: ctx.promptUsage.promptTokens,
      completionTokens,
      totalTokens: ctx.promptUsage.promptTokens + completionTokens,
      promptBudgetTokens: ctx.promptUsage.promptBudgetTokens,
      promptTruncated: ctx.promptUsage.promptTruncated,
    },
    budgetWarning,
  };
}
