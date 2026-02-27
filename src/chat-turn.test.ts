import { describe, expect, test } from "bun:test";
import { appendInputHistory, applyUserTurn, buildInputHistory, runAssistantTurn } from "./chat-turn";
import { formatToolLabel } from "./tool-labels";
import type { Session } from "./types";

describe("chat turn helpers", () => {
  test("appendInputHistory avoids duplicate consecutive entries", () => {
    expect(appendInputHistory(["hello"], "hello")).toEqual(["hello"]);
    expect(appendInputHistory(["hello"], "world")).toEqual(["hello", "world"]);
  });

  test("buildInputHistory reconstructs user prompt history from messages", () => {
    const history = buildInputHistory([
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

  test("formatToolLabel maps known tool ids to user-facing labels", () => {
    expect(formatToolLabel("run-command")).toBe("Run");
    expect(formatToolLabel("read-file")).toBe("Read");
    expect(formatToolLabel("web-search")).toBe("Search");
  });

  test("formatToolLabel title-cases unknown tool ids", () => {
    expect(formatToolLabel("custom-check")).toBe("Custom Check");
  });

  test("runAssistantTurn ignores reply progress payload rows", async () => {
    const turn = await runAssistantTurn({
      client: {
        replyStream: async () => ({
          model: "gpt-5-mini",
          output: "done",
        }),
        status: async () => ({}),
        setPermissionMode: async () => {},
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

    const toolRows = turn.rows.filter((row) => row.style === "toolProgress");
    expect(toolRows).toHaveLength(0);
    expect(turn.rows.some((row) => row.role === "assistant" && row.content === "done")).toBe(true);
  });
});
