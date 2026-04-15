import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAgentInput, setTokenEncoder } from "./agent-input";
import type { ChatRequest } from "./api";
import { defaultLifecyclePolicy } from "./lifecycle-policy";

const defaultOptions = {
  contextMaxTokens: defaultLifecyclePolicy.contextMaxTokens,
};

// Use a deterministic chars/4 estimator so budget tests don't depend on the tiktoken encoding.
const charsPerToken = 4;
beforeAll(() => setTokenEncoder({ encode: (input: string) => ({ length: Math.ceil(input.length / charsPerToken) }) }));
afterAll(() => setTokenEncoder(null));

function createRequest(content: string): ChatRequest {
  return {
    model: "gpt-5-mini",
    message: "review this",
    history: [
      {
        id: "msg_system",
        role: "system",
        content,
        timestamp: "2026-02-20T10:00:00.000Z",
      },
    ],
  };
}

describe("createAgentInput", () => {
  test("includes full message content when budget allows", () => {
    const longSystem = `General note: ${"B".repeat(4000)}`;
    const { input } = createAgentInput(createRequest(longSystem), defaultOptions);
    expect(input).toContain("General note:");
    expect(input).toContain("B".repeat(4000));
    expect(input).not.toContain("…");
  });

  test("includes skill context in input when activeSkills present", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "use repo conventions",
      history: [],
      activeSkills: [{ name: "build", instructions: "keep slices small." }],
    };

    const { input, usage } = createAgentInput(req, defaultOptions);
    expect(input).toContain("SYSTEM: Active skill (build)");
    expect(input).toContain("keep slices small.");
    expect(usage.skillTokens).toBeGreaterThan(0);
    expect(usage.messageTokens).toBeLessThan(usage.inputTokens);
  });

  test("reports provided tool token reservation in usage", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "use tools",
      history: [],
    };

    const { usage } = createAgentInput(req, {
      ...defaultOptions,
      toolTokens: 321,
      systemPromptTokens: 123,
    });
    expect(usage.toolTokens).toBe(321);
    expect(usage.systemPromptTokens).toBe(123);
  });

  test("reports requested system/tool tokens even when they exceed context budget", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "continue",
      history: [
        {
          id: "msg_history",
          role: "assistant",
          content: "HISTORY_SENTINEL",
          timestamp: "2026-02-20T10:00:00.000Z",
        },
      ],
    };

    const { input, usage } = createAgentInput(req, {
      ...defaultOptions,
      contextMaxTokens: 100,
      systemPromptTokens: 70,
      toolTokens: 60,
    });
    expect(usage.systemPromptTokens).toBe(70);
    expect(usage.toolTokens).toBe(60);
    expect(input).not.toContain("HISTORY_SENTINEL");
  });

  test("keeps pinned skill context before recent chat when budget is tight", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "use repo conventions",
      activeSkills: [{ name: "build", instructions: "keep slices small." }],
      history: [
        {
          id: "msg_user",
          role: "user",
          content: "x".repeat(10_000),
          timestamp: "2026-02-20T10:00:01.000Z",
        },
      ],
    };

    const { input } = createAgentInput(req, defaultOptions);
    expect(input).toContain("SYSTEM: Active skill (build)");
    expect(input).toContain("USER: use repo conventions");
  });

  test("respects hard context token budget approximately", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "review",
      history: Array.from({ length: 100 }).map((_, index) => ({
        id: `msg_${index}`,
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `line-${index} ${"z".repeat(1000)}`,
        timestamp: `2026-02-20T10:00:${String(index).padStart(2, "0")}.000Z`,
      })),
    };

    const { input } = createAgentInput(req, defaultOptions);
    expect(input.length).toBeLessThanOrEqual(120_000);
    expect(input).toContain("USER: review");
  });

  test("includes full tool payload content when budget allows", () => {
    const toolHeavy = `stdout:\n${"A".repeat(5000)}\nstderr:\n${"B".repeat(2000)}`;
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "continue",
      history: [
        {
          id: "msg_old_tool",
          role: "assistant",
          content: toolHeavy,
          kind: "tool_payload",
          timestamp: "2026-02-20T10:00:00.000Z",
        },
        {
          id: "msg_old_user",
          role: "user",
          content: "thanks",
          timestamp: "2026-02-20T10:00:01.000Z",
        },
        {
          id: "msg_recent_assistant",
          role: "assistant",
          content: "Ready for the next step.",
          timestamp: "2026-02-20T10:00:02.000Z",
        },
      ],
    };

    const { input } = createAgentInput(req, defaultOptions);
    expect(input).toContain("A".repeat(5000));
    expect(input).toContain("B".repeat(2000));
    expect(input).toContain("ASSISTANT: Ready for the next step.");
  });

  test("keeps newest oversized history turn by truncating to remaining budget", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "U".repeat(380),
      history: [
        {
          id: "msg_old",
          role: "assistant",
          content: "older context that should lose to newest turn",
          timestamp: "2026-02-20T10:00:00.000Z",
        },
        {
          id: "msg_new",
          role: "assistant",
          content: `LATEST ${"x".repeat(4000)}`,
          timestamp: "2026-02-20T10:00:01.000Z",
        },
      ],
    };

    const { input } = createAgentInput(req, { ...defaultOptions, contextMaxTokens: 120 });
    expect(input).toContain("ASSISTANT: LATEST");
    expect(input).toContain("…");
    expect(input).not.toContain("older context that should lose to newest turn");
  });

  test("prioritizes conversational turns before old tool payloads under tight budget", () => {
    const req: ChatRequest = {
      model: "gpt-5-mini",
      message: "U".repeat(380),
      history: [
        {
          id: "msg_old_tool",
          role: "assistant",
          kind: "tool_payload",
          content: `TOOL_SENTINEL ${"A".repeat(5000)}`,
          timestamp: "2026-02-20T10:00:00.000Z",
        },
        {
          id: "msg_keep_1",
          role: "assistant",
          content: `KEEP_ONE ${"x".repeat(500)}`,
          timestamp: "2026-02-20T10:00:01.000Z",
        },
        {
          id: "msg_keep_2",
          role: "user",
          content: `KEEP_TWO ${"y".repeat(500)}`,
          timestamp: "2026-02-20T10:00:02.000Z",
        },
      ],
    };

    const { input } = createAgentInput(req, { ...defaultOptions, contextMaxTokens: 120 });
    expect(input).toContain("KEEP_TWO");
    expect(input).not.toContain("TOOL_SENTINEL");
  });
});
