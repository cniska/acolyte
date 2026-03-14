import { describe, expect, test } from "bun:test";
import { parseChatResponse, parseStreamEvent } from "./client-contract";

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
