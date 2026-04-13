import { estimateTokens } from "./agent-input";
import type { ChatResponse } from "./api";
import { t } from "./i18n";
import type { RunContext } from "./lifecycle-contract";
import { stripSignalLine } from "./lifecycle-signal";
import { totalPromptBreakdownTokens } from "./lifecycle-usage";
import { DISCOVERY_TOOL_SET, READ_TOOL_SET, SEARCH_TOOL_SET, WRITE_TOOL_SET } from "./tool-registry";
import { scopedCallLog } from "./tool-session";

export function phaseFinalize(ctx: RunContext): ChatResponse {
  const rawOutput = stripSignalLine(ctx.result?.text ?? "").trim();
  const output =
    rawOutput.length > 0
      ? rawOutput
      : ctx.observedTools.size > 0
        ? t("agent.output.no_response_after_tools")
        : t("agent.output.no_output");

  const promptInputTokens = totalPromptBreakdownTokens(ctx.promptBreakdownTotals);
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
    active_skill: ctx.promptUsage.activeSkillName ?? null,
    skill_instruction_chars: ctx.promptUsage.skillInstructionChars ?? null,
    last_error_code: ctx.currentError?.code ?? null,
    last_error_category: ctx.currentError?.category ?? null,
    timeout_error_count: ctx.errorStats.timeout,
    file_not_found_error_count: ctx.errorStats["file-not-found"],
    budget_blocked_count: ctx.errorStats["budget-exhausted"],
    other_error_count: ctx.errorStats.other,
  });

  return {
    state: ctx.result?.signal === "blocked" ? "awaiting-input" : "done",
    model: ctx.model,
    output,
    ...(ctx.currentError ? { error: ctx.currentError.message } : {}),
    toolCalls: callLog.map((entry) => entry.toolName),
    modelCalls: ctx.modelCallCount,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      inputBudgetTokens: ctx.promptUsage.inputBudgetTokens,
      inputTruncated: ctx.promptUsage.inputTruncated,
    },
    promptBreakdown: {
      budgetTokens: ctx.promptUsage.inputBudgetTokens,
      usedTokens: inputTokens,
      systemTokens: ctx.promptBreakdownTotals.systemTokens,
      toolTokens: ctx.promptBreakdownTotals.toolTokens,
      memoryTokens: ctx.promptBreakdownTotals.memoryTokens,
      messageTokens: ctx.promptBreakdownTotals.messageTokens,
    },
  };
}
