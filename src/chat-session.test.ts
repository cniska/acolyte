import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "./chat-contract";
import { createTokenUsageEntry, toRows } from "./chat-session";

describe("chat session helpers", () => {
  test("toRows keeps only user and assistant messages", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "system", content: "x", timestamp: "" },
      { id: "2", role: "user", content: "u1", timestamp: "" },
      { id: "3", role: "assistant", content: "a1", timestamp: "" },
      { id: "4", role: "user", content: "u2", timestamp: "" },
    ];
    const rows = toRows(messages);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.content).toBe("u1");
    expect(rows[1]?.content).toBe("a1");
    expect(rows[2]?.content).toBe("u2");
  });
});

describe("createTokenUsageEntry", () => {
  test("derives the total a turn did not report", () => {
    const entry = createTokenUsageEntry({ usage: { inputTokens: 1200, outputTokens: 340 } });
    expect(entry.usage).toEqual({ inputTokens: 1200, outputTokens: 340, totalTokens: 1540 });
  });

  test("keeps a reported total and budget rather than recomputing", () => {
    const entry = createTokenUsageEntry({
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 99, inputBudgetTokens: 170_000 },
    });
    expect(entry.usage.totalTokens).toBe(99);
    expect(entry.usage.inputBudgetTokens).toBe(170_000);
  });

  test("attributes the entry to a message when the turn produced one, else to itself", () => {
    expect(createTokenUsageEntry({ id: "msg_abc", usage: { inputTokens: 1, outputTokens: 1 } }).id).toBe("msg_abc");
    expect(createTokenUsageEntry({ usage: { inputTokens: 1, outputTokens: 1 } }).id).toMatch(/^msg_/);
  });

  test("carries the breakdown a completed turn reports", () => {
    const entry = createTokenUsageEntry({
      id: "msg_abc",
      usage: { inputTokens: 1, outputTokens: 1 },
      promptBreakdown: {
        budgetTokens: 170_000,
        usedTokens: 6,
        systemTokens: 5,
        toolTokens: 4,
        skillTokens: 3,
        memoryTokens: 2,
        messageTokens: 1,
      },
      modelCalls: 2,
    });
    expect(entry.promptBreakdown?.systemTokens).toBe(5);
    expect(entry.modelCalls).toBe(2);
  });
});
