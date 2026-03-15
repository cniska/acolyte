import { describe, expect, test } from "bun:test";
import { parseChatResponse, parseStreamEvent } from "./client-contract";
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

  test("parseChatResponse ignores non-string error", () => {
    const response = parseChatResponse({
      output: "Hello",
      model: "gpt-5-mini",
      error: 42,
    });
    expect(response).not.toBeNull();
    expect(response?.error).toBeUndefined();
  });

  test("parseChatResponse accepts legacy prompt/completion usage fields", () => {
    const response = parseChatResponse({
      output: "Hello",
      model: "gpt-5-mini",
      usage: {
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
        promptBudgetTokens: 100,
        promptTruncated: true,
      },
    });
    expect(response?.usage?.inputTokens).toBe(12);
    expect(response?.usage?.outputTokens).toBe(8);
    expect(response?.usage?.totalTokens).toBe(20);
    expect(response?.usage?.inputBudgetTokens).toBe(100);
    expect(response?.usage?.inputTruncated).toBe(true);
  });

  test("parseStreamEvent accepts legacy usage event fields", () => {
    const event = parseStreamEvent({
      type: "usage",
      promptTokens: 9,
      completionTokens: 4,
    });
    expect(event).toEqual({ type: "usage", inputTokens: 9, outputTokens: 4 });
  });
});

describe("phaseFinalize", () => {
  test("uses estimated prompt tokens when stream usage is unavailable", () => {
    const ctx = createRunContext({
      promptUsage: {
        inputTokens: 12,
        systemPromptTokens: 48,
        toolTokens: 20,
        memoryTokens: 8,
        messageTokens: 12,
        inputBudgetTokens: 100,
        inputTruncated: false,
        includedHistoryMessages: 3,
        totalHistoryMessages: 6,
      },
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
        memoryTokens: 8,
        messageTokens: 12,
        inputBudgetTokens: 100,
        inputTruncated: false,
        includedHistoryMessages: 3,
        totalHistoryMessages: 6,
      },
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
        memoryTokens: 8,
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
        memoryTokens: 16,
        messageTokens: 34,
      },
      result: { text: "done", toolCalls: [] },
    });

    const response = phaseFinalize(ctx);

    expect(response.usage?.inputTokens).toBe(170);
    expect(response.promptBreakdown).toEqual({
      budgetTokens: 100,
      usedTokens: 170,
      systemTokens: 80,
      toolTokens: 40,
      memoryTokens: 16,
      messageTokens: 34,
    });
  });
});
