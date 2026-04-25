import { estimateTokens } from "./agent-input";
import type { ChatResponse } from "./api";
import { t } from "./i18n";
import { promptUsageTotalTokens, type RunContext } from "./lifecycle-contract";
import { stripSignalLine } from "./lifecycle-signal";
import { DISCOVERY_TOOL_SET, READ_TOOL_SET, SEARCH_TOOL_SET, WRITE_TOOL_SET } from "./tool-registry";
import { scopedCallLog } from "./tool-session";

export function phaseFinalize(ctx: RunContext): ChatResponse {
  const unresolvedToolError = ctx.currentError?.source === "tool-error" || ctx.currentError?.source === "tool-result";
  const rawOutput = unresolvedToolError
    ? (ctx.currentError?.message ?? "")
    : stripSignalLine(ctx.result?.text ?? "").trim();
  const output =
    rawOutput.length > 0
      ? rawOutput
      : ctx.observedTools.size > 0
        ? t("agent.output.no_response_after_tools")
        : t("agent.output.no_output");

  const { promptUsage } = ctx;
  const promptInputTokens = promptUsageTotalTokens(promptUsage);
  const inputTokens = Math.max(ctx.inputTokensAccum, promptInputTokens);
  const outputTokens = ctx.outputTokensAccum || estimateTokens(output);

  const callLog = scopedCallLog(ctx.session, ctx.taskId);
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
    pre_write_discovery_calls: preWriteDiscoveryCalls,
    lifecycle_signal: ctx.result?.signal ?? null,
    budget_blocked: ctx.errorStats["budget-exhausted"] > 0,
    active_skills: ctx.request.activeSkills?.map((s) => s.name) ?? null,
    last_error_code: ctx.currentError?.code ?? null,
    last_error_category: ctx.currentError?.category ?? null,
    timeout_error_count: ctx.errorStats.timeout,
    file_not_found_error_count: ctx.errorStats["file-not-found"],
    budget_blocked_count: ctx.errorStats["budget-exhausted"],
    other_error_count: ctx.errorStats.other,
  });

  return {
    state: unresolvedToolError || ctx.result?.signal === "blocked" ? "awaiting-input" : "done",
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
