import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { appConfig } from "./app-config";
import { createModelPicker, createResumePicker } from "./chat-picker-actions";
import { invalidateModelsCache } from "./provider-models";
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

let savedApiKey: string | undefined;

beforeEach(() => {
  savedApiKey = appConfig.openai.apiKey;
  (appConfig.openai as { apiKey: string | undefined }).apiKey = "test-key";
});

afterEach(() => {
  (appConfig.openai as { apiKey: string | undefined }).apiKey = savedApiKey;
  invalidateModelsCache();
  mock.restore();
});

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
      scrollOffset: 0,
    });
  });

  test("createModelPicker fetches models and returns picker state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ data: [{ id: "gpt-5-mini" }, { id: "gpt-5.2" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const picker = await createModelPicker();
      expect(picker.kind).toBe("model");
      if (picker.kind !== "model") throw new Error("Expected model picker");
      expect(picker.items.length).toBeGreaterThan(0);
      expect(picker.filtered.length).toBeGreaterThan(0);
      expect(picker.query).toBe("");
      expect(picker.scrollOffset).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
