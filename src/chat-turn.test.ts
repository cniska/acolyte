import { describe, expect, test } from "bun:test";
import { appendInputHistory, applyUserTurn } from "./chat-turn";
import type { Session } from "./types";

describe("chat turn helpers", () => {
  test("appendInputHistory avoids duplicate consecutive entries", () => {
    expect(appendInputHistory(["hello"], "hello")).toEqual(["hello"]);
    expect(appendInputHistory(["hello"], "world")).toEqual(["hello", "world"]);
  });

  test("applyUserTurn appends message and initializes title", () => {
    const session: Session = {
      id: "sess_1",
      title: "New Session",
      model: "gpt-5-mini",
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
      messages: [],
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
});
