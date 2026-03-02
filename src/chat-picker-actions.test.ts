import { describe, expect, test } from "bun:test";
import {
  boundedSkillInstructions,
  createClarifyAnswerPicker,
  createPicker,
  createResumePicker,
  createResumeRows,
  createWriteConfirmPicker,
} from "./chat-picker-actions";
import type { Session, SessionStore } from "./types";

function session(id: string, title = "New Session"): Session {
  return {
    id,
    title,
    model: "gpt-5-mini",
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
    messages: [],
    tokenUsage: [],
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
      content: "Resumed session: sess_abc123456789",
      style: "sessionStatus",
    });
  });

  test("boundedSkillInstructions truncates with ellipsis", () => {
    expect(boundedSkillInstructions("abcdef", 6)).toBe("abcdef");
    expect(boundedSkillInstructions("abcdefg", 6)).toBe("abcde…");
  });

  test("createPicker builds typed picker from config", () => {
    const picker = createPicker({
      kind: "permissions",
      items: [
        { mode: "read", description: "inspect/search only" },
        { mode: "write", description: "allow edits and shell commands" },
      ],
      index: 1,
    });
    expect(picker.kind).toBe("permissions");
    expect(picker.items[1]?.mode).toBe("write");
  });

  test("createWriteConfirmPicker returns switch/cancel options", () => {
    const picker = createWriteConfirmPicker("edit src/cli.ts");
    expect(picker).toMatchObject({ kind: "writeConfirm", index: 0, prompt: "edit src/cli.ts" });
  });

  test("createClarifyAnswerPicker returns one-question answer picker", () => {
    const picker = createClarifyAnswerPicker("implement feature x", "First question?", ["Second question?"]);
    expect(picker).toMatchObject({
      kind: "clarifyAnswer",
      question: "First question?",
      remaining: ["Second question?"],
      items: [
        { value: "answer", description: "use this answer" },
        { value: "other", description: "use a different option" },
      ],
      index: 0,
      note: "",
    });
  });
});
