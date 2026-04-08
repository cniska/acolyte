import { describe, expect, test } from "bun:test";
import { parseChatResponse } from "./client-contract";
import { phaseFinalize } from "./lifecycle-finalize";
import { createRunContext } from "./test-utils";

describe("ChatResponse error field", () => {
  test("parseChatResponse preserves error field", () => {
    const response = parseChatResponse({
      output: "No output from model.",
      model: "gpt-5-mini",
      error: "Your credit balance is too low",
    });
    expect(response).not.toBeNull();
    expect(response?.error).toBe("Your credit balance is too low");
  });

  test("parseChatResponse omits error when not present", () => {
    const response = parseChatResponse({
      output: "Hello",
      model: "gpt-5-mini",
    });
    expect(response).not.toBeNull();
    expect(response?.error).toBeUndefined();
  });

  test("parseChatResponse rejects non-string error", () => {
    const response = parseChatResponse({
      output: "Hello",
      model: "gpt-5-mini",
      error: 42,
    });
    expect(response).toBeNull();
  });
});

describe("phaseFinalize", () => {
  test("uses prompt breakdown totals for token accounting", () => {
    const ctx = createRunContext({
      promptUsage: {
        inputTokens: 12,
        systemPromptTokens: 48,
        toolTokens: 20,
        memoryTokens: 0,
        messageTokens: 12,
        inputBudgetTokens: 100,
        inputTruncated: false,
        includedHistoryMessages: 3,
        totalHistoryMessages: 6,
      },
      promptBreakdownTotals: { systemTokens: 48, toolTokens: 20, memoryTokens: 0, messageTokens: 12 },
      inputTokensAccum: 0,
      outputTokensAccum: 0,
      result: { text: "done", toolCalls: [] },
    });

    const response = phaseFinalize(ctx);

    expect(response.usage?.inputTokens).toBe(80);
    expect(response.usage?.totalTokens).toBe(81);
    expect(response.promptBreakdown?.usedTokens).toBe(80);
  });

  test("includes promptBreakdown when currentError is set", () => {
    const ctx = createRunContext({
      promptUsage: {
        inputTokens: 12,
        systemPromptTokens: 48,
        toolTokens: 20,
        memoryTokens: 0,
        messageTokens: 12,
        inputBudgetTokens: 100,
        inputTruncated: false,
        includedHistoryMessages: 3,
        totalHistoryMessages: 6,
      },
      promptBreakdownTotals: { systemTokens: 48, toolTokens: 20, memoryTokens: 0, messageTokens: 12 },
      inputTokensAccum: 0,
      outputTokensAccum: 0,
      currentError: { message: "tool failed", category: "other" },
      result: { text: "", toolCalls: [] },
    });

    const response = phaseFinalize(ctx);

    expect(response.error).toBe("tool failed");
    expect(response.promptBreakdown).toBeDefined();
    expect(response.promptBreakdown?.usedTokens).toBe(80);
  });

  test("uses accumulated prompt breakdown totals across multiple model calls", () => {
    const ctx = createRunContext({
      baseAgentInput: "USER: first prompt",
      promptUsage: {
        inputTokens: 12,
        systemPromptTokens: 48,
        toolTokens: 20,
        memoryTokens: 0,
        messageTokens: 12,
        inputBudgetTokens: 100,
        inputTruncated: false,
        includedHistoryMessages: 3,
        totalHistoryMessages: 6,
      },
      inputTokensAccum: 120,
      promptBreakdownTotals: {
        systemTokens: 80,
        toolTokens: 40,
        memoryTokens: 0,
        messageTokens: 34,
      },
      result: { text: "done", toolCalls: [] },
    });

    const response = phaseFinalize(ctx);

    expect(response.usage?.inputTokens).toBe(154);
    expect(response.promptBreakdown).toEqual({
      budgetTokens: 100,
      usedTokens: 154,
      systemTokens: 80,
      toolTokens: 40,
      memoryTokens: 0,
      messageTokens: 34,
    });
  });

  test("sets state to awaiting-input when signal is blocked", () => {
    const ctx = createRunContext({
      result: { text: "Which environment should I deploy to?", toolCalls: [], signal: "blocked" },
    });
    const response = phaseFinalize(ctx);
    expect(response.state).toBe("awaiting-input");
    expect(response.output).toBe("Which environment should I deploy to?");
  });

  test("sets state to done when signal is done", () => {
    const ctx = createRunContext({
      result: { text: "Done.", toolCalls: [], signal: "done" },
    });
    const response = phaseFinalize(ctx);
    expect(response.state).toBe("done");
  });
});
