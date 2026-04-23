import { describe, expect, test } from "bun:test";
import type { LanguageModelV3FunctionTool, LanguageModelV3Message } from "@ai-sdk/provider";
import { estimatePromptSize, promptBudgetError } from "./prompt-size";

describe("estimatePromptSize", () => {
  test("returns zero totals when inputs are empty", () => {
    const size = estimatePromptSize([], []);
    expect(size).toEqual({ total: 0, system: 0, tools: 0, messages: 0 });
  });

  test("counts system-role messages under system", () => {
    const messages: LanguageModelV3Message[] = [{ role: "system", content: "you are helpful" }];
    const size = estimatePromptSize(messages, []);
    expect(size.system).toBeGreaterThan(0);
    expect(size.tools).toBe(0);
    expect(size.messages).toBe(0);
    expect(size.total).toBe(size.system);
  });

  test("counts tool definitions", () => {
    const tools: LanguageModelV3FunctionTool[] = [
      { type: "function", name: "file-read", description: "Read a file", inputSchema: { type: "object" } },
    ];
    const size = estimatePromptSize([], tools);
    expect(size.tools).toBeGreaterThan(0);
    expect(size.total).toBe(size.tools);
  });

  test("counts non-system messages separately from system", () => {
    const messages: LanguageModelV3Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: [{ type: "text", text: "hello from the user" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc_1",
            toolName: "file-read",
            output: { type: "text", value: "file contents here".repeat(10) },
          },
        ],
      },
    ];
    const size = estimatePromptSize(messages, []);
    expect(size.system).toBeGreaterThan(0);
    expect(size.messages).toBeGreaterThan(0);
    expect(size.total).toBe(size.system + size.messages);
  });

  test("does not double-count the system message", () => {
    const systemOnly = estimatePromptSize([{ role: "system", content: "sys" }], []);
    const both = estimatePromptSize(
      [
        { role: "system", content: "sys" },
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
      [],
    );
    expect(both.system).toBe(systemOnly.system);
    expect(both.messages).toBeGreaterThan(0);
    expect(both.total).toBe(both.system + both.messages);
  });

  test("total is the sum of system, tools, and messages", () => {
    const messages: LanguageModelV3Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];
    const tools: LanguageModelV3FunctionTool[] = [
      { type: "function", name: "t", description: "t", inputSchema: { type: "object" } },
    ];
    const size = estimatePromptSize(messages, tools);
    expect(size.total).toBe(size.system + size.tools + size.messages);
  });
});

describe("promptBudgetError", () => {
  test("returns undefined when total is under the limit", () => {
    expect(promptBudgetError({ total: 50, system: 10, tools: 10, messages: 30 }, 100)).toBeUndefined();
  });

  test("returns undefined when total equals the limit", () => {
    expect(promptBudgetError({ total: 100, system: 10, tools: 10, messages: 80 }, 100)).toBeUndefined();
  });

  test("returns a message with the breakdown when total exceeds the limit", () => {
    const msg = promptBudgetError({ total: 150, system: 20, tools: 30, messages: 100 }, 100);
    expect(msg).toBeDefined();
    expect(msg).toContain("150");
    expect(msg).toContain("100");
    expect(msg).toContain("system=20");
    expect(msg).toContain("tools=30");
    expect(msg).toContain("messages=100");
  });
});
