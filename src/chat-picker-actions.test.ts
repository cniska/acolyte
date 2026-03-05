import { describe, expect, test } from "bun:test";
import { appConfig } from "./app-config";
import {
  createModelPicker,
  createPicker,
  createResumePicker,
  createResumeRows,
  createWriteConfirmPicker,
} from "./chat-picker-actions";
import type { Session, SessionState } from "./session-contract";

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
    const store: SessionState = {
      activeSessionId: undefined,
      sessions: [],
    };
    expect(createResumePicker(store)).toBeNull();
  });

  test("createResumePicker selects active session index", () => {
    const first = session("sess_a");
    const second = session("sess_b");
    const store: SessionState = {
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

  test("createModelPicker suggests six models when openai and anthropic are configured", () => {
    const previousOpenaiKey = appConfig.openai.apiKey;
    const previousAnthropicKey = appConfig.anthropic.apiKey;
    const previousGoogleKey = appConfig.google.apiKey;
    try {
      (appConfig.openai as { apiKey?: string }).apiKey = "sk-openai";
      (appConfig.anthropic as { apiKey?: string }).apiKey = "sk-anthropic";
      (appConfig.google as { apiKey?: string }).apiKey = undefined;

      const picker = createModelPicker("gpt-5-mini");
      expect(picker.kind).toBe("model");
      if (picker.kind !== "model") throw new Error("Expected model picker");
      const suggested = picker.items.filter((item) => item.model !== "other");
      expect(suggested).toHaveLength(6);
    } finally {
      (appConfig.openai as { apiKey?: string }).apiKey = previousOpenaiKey;
      (appConfig.anthropic as { apiKey?: string }).apiKey = previousAnthropicKey;
      (appConfig.google as { apiKey?: string }).apiKey = previousGoogleKey;
    }
  });
});
