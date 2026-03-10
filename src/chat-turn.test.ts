import { describe, expect, test } from "bun:test";
import { appendInputHistory, applyUserTurn, createInputHistory, runAssistantTurn } from "./chat-turn";
import type { Session } from "./session-contract";

describe("chat turn helpers", () => {
  test("appendInputHistory avoids duplicate consecutive entries", () => {
    expect(appendInputHistory(["hello"], "hello")).toEqual(["hello"]);
    expect(appendInputHistory(["hello"], "world")).toEqual(["hello", "world"]);
  });

  test("createInputHistory reconstructs user prompt history from messages", () => {
    const history = createInputHistory([
      { id: "m1", role: "system", content: "Pinned memory", timestamp: "2026-02-21T10:00:00.000Z" },
      { id: "m2", role: "user", content: "  hello  ", timestamp: "2026-02-21T10:00:01.000Z" },
      { id: "m3", role: "assistant", content: "Hi", timestamp: "2026-02-21T10:00:02.000Z" },
      { id: "m4", role: "user", content: "hello", timestamp: "2026-02-21T10:00:03.000Z" },
      { id: "m5", role: "user", content: "review @src/agent.ts", timestamp: "2026-02-21T10:00:04.000Z" },
      { id: "m6", role: "user", content: " ", timestamp: "2026-02-21T10:00:05.000Z" },
    ]);
    expect(history).toEqual(["hello", "review @src/agent.ts"]);
  });

  test("applyUserTurn appends message and initializes title", () => {
    const session: Session = {
      id: "sess_1",
      title: "New Session",
      model: "gpt-5-mini",
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
      messages: [],
      tokenUsage: [],
    };
    const result = applyUserTurn({
      session,
      displayText: "hello there",
      userText: "hello there",
      nowIso: () => "2026-02-20T00:00:01.000Z",
      createMessage: (role, content) => ({
        id: "msg_1",
        role,
        content,
        timestamp: "2026-02-20T00:00:01.000Z",
      }),
    });

    expect(session.messages).toHaveLength(1);
    expect(session.title).toBe("hello there");
    expect(session.updatedAt).toBe("2026-02-20T00:00:01.000Z");
    expect(result.row).toEqual({
      id: "msg_1",
      role: "user",
      content: "hello there",
    });
  });

  test("runAssistantTurn ignores reply progress payload rows", async () => {
    const turn = await runAssistantTurn({
      client: {
        replyStream: async () => ({
          model: "gpt-5-mini",
          output: "done",
        }),
        status: async () => ({}),
        taskStatus: async () => null,
      },
      userText: "create a rust script",
      history: [],
      model: "gpt-5-mini",
      sessionId: "sess_test",
      thinkingStartedAt: Date.now(),
      createMessage: (role, content) => ({
        id: "msg_assistant",
        role,
        content,
        timestamp: "2026-02-20T00:00:00.000Z",
      }),
    });

    const toolRows = turn.rows.filter((row) => row.style === "toolOutput");
    expect(toolRows).toHaveLength(0);
    expect(turn.rows.some((row) => row.role === "assistant" && row.content === "done")).toBe(true);
  });

  test("runAssistantTurn marks assistant message as tool_payload when tools were used", async () => {
    const turn = await runAssistantTurn({
      client: {
        replyStream: async () => ({
          model: "gpt-5-mini",
          output: "done",
          toolCalls: ["read-file"],
        }),
        status: async () => ({}),
        taskStatus: async () => null,
      },
      userText: "read src/agent.ts",
      history: [],
      model: "gpt-5-mini",
      sessionId: "sess_test",
      thinkingStartedAt: Date.now(),
      createMessage: (role, content) => ({
        id: "msg_assistant",
        role,
        content,
        timestamp: "2026-02-20T00:00:00.000Z",
      }),
    });

    expect(turn.assistantMessage.kind).toBe("tool_payload");
  });

  test("runAssistantTurn adds inline budget warning row when present", async () => {
    const turn = await runAssistantTurn({
      client: {
        replyStream: async () => ({
          model: "gpt-5-mini",
          output: "done",
          budgetWarning: "context near budget (7900/8000 tokens)",
        }),
        status: async () => ({}),
        taskStatus: async () => null,
      },
      userText: "summarize recent work",
      history: [],
      model: "gpt-5-mini",
      sessionId: "sess_test",
      thinkingStartedAt: Date.now(),
      createMessage: (role, content) => ({
        id: "msg_assistant",
        role,
        content,
        timestamp: "2026-02-20T00:00:00.000Z",
      }),
    });

    expect(turn.rows.some((row) => row.role === "system" && row.content.includes("context near budget"))).toBe(true);
  });
});
