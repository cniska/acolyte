import { estimateTokens } from "./agent-input";
import type { ChatResponse } from "./api";
import { t } from "./i18n";
import { guardStatsFromSession, type RunContext, taskScopedCallLog } from "./lifecycle-contract";
import { DISCOVERY_TOOL_SET, READ_TOOL_SET, SEARCH_TOOL_SET, WRITE_TOOL_SET } from "./tool-registry";

export function phaseFinalize(ctx: RunContext): ChatResponse {
  const rawOutput = ctx.result?.text.trim() ?? "";
  const output =
    rawOutput.length > 0
      ? rawOutput
      : ctx.observedTools.size > 0
        ? t("agent.output.no_response_after_tools")
        : t("agent.output.no_output");

  const completionTokens = estimateTokens(output);
  let budgetWarning: string | undefined;
  if (ctx.promptUsage.promptTruncated) {
    budgetWarning = t("lifecycle.budget.trimmed", {
      included: t("unit.history_message", { count: ctx.promptUsage.includedHistoryMessages }),
      total: ctx.promptUsage.totalHistoryMessages,
    });
  } else if (ctx.promptUsage.promptTokens >= Math.floor(ctx.promptUsage.promptBudgetTokens * 0.9)) {
    budgetWarning = t("lifecycle.budget.near", {
      used: ctx.promptUsage.promptTokens,
      budget: ctx.promptUsage.promptBudgetTokens,
    });
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
    mode: ctx.initialMode,
    model: ctx.model,
    model_calls: ctx.modelCallCount,
    tool_calls: totalToolCalls,
    unique_tool_count: ctx.observedTools.size,
    tools: Array.from(ctx.observedTools).join(","),
    has_error: Boolean(ctx.currentError),
    output_chars: output.length,
    budget_warning: budgetWarning ?? null,
    read_calls: readCalls,
    search_calls: searchCalls,
    write_calls: writeCalls,
    pre_write_discovery_calls: preWriteDiscoveryCalls,
    regeneration_count: ctx.regenerationCount,
    regeneration_limit_hit: ctx.regenerationLimitHit,
    guard_blocked_count: guardStats.blocked,
    guard_flag_set_count: guardStats.flagSet,
    active_skill: ctx.promptUsage.activeSkillName ?? null,
    skill_instruction_chars: ctx.promptUsage.skillInstructionChars ?? null,
    last_error_code: ctx.currentError?.code ?? null,
    last_error_category: ctx.currentError?.category ?? null,
    timeout_error_count: ctx.errorStats.timeout,
    file_not_found_error_count: ctx.errorStats["file-not-found"],
    guard_blocked_error_count: ctx.errorStats["guard-blocked"],
    other_error_count: ctx.errorStats.other,
  });

  return {
    model: ctx.model,
    output,
    ...(ctx.currentError ? { error: ctx.currentError.message } : {}),
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
