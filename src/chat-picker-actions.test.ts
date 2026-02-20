import { describe, expect, test } from "bun:test";
import { boundedSkillInstructions, createResumePicker, createResumeRows } from "./chat-picker-actions";
import type { Session, SessionStore } from "./types";

function session(id: string, title = "New Session"): Session {
  return {
    id,
    title,
    model: "gpt-5-mini",
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
    messages: [],
  };
}

describe("chat picker actions", () => {
  test("createResumePicker returns null when there are no sessions", () => {
    const store: SessionStore = {
      activeSessionId: undefined,
      sessions: [],
    };
    expect(createResumePicker(store)).toBeNull();
  });

  test("createResumePicker selects active session index", () => {
    const first = session("sess_a");
    const second = session("sess_b");
    const store: SessionStore = {
      activeSessionId: "sess_b",
      sessions: [first, second],
    };
    expect(createResumePicker(store)).toEqual({
      kind: "resume",
      items: [first, second],
      index: 1,
    });
  });

  test("createResumeRows appends resumed session row", () => {
    const selected = session("sess_abc123456789");
    const rows = createResumeRows(selected, () => [{ id: "x", role: "assistant", content: "existing" }]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      role: "assistant",
      content: "Resumed session: sess_abc1234",
    });
  });

  test("boundedSkillInstructions truncates with ellipsis", () => {
    expect(boundedSkillInstructions("abcdef", 6)).toBe("abcdef");
    expect(boundedSkillInstructions("abcdefg", 6)).toBe("abcde…");
  });
});
