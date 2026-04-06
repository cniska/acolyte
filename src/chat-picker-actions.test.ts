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
let savedBaseUrl: string | undefined;
let savedAnthropicApiKey: string | undefined;
let savedGoogleApiKey: string | undefined;

beforeEach(() => {
  savedApiKey = appConfig.openai.apiKey;
  savedBaseUrl = appConfig.openai.baseUrl;
  savedAnthropicApiKey = appConfig.anthropic.apiKey;
  savedGoogleApiKey = appConfig.google.apiKey;
  (appConfig.openai as { apiKey: string | undefined }).apiKey = "test-key";
  (appConfig.openai as { baseUrl: string }).baseUrl = "https://api.openai.com/v1";
  (appConfig.anthropic as { apiKey: string | undefined }).apiKey = undefined;
  (appConfig.google as { apiKey: string | undefined }).apiKey = undefined;
});

afterEach(() => {
  (appConfig.openai as { apiKey: string | undefined }).apiKey = savedApiKey;
  (appConfig.openai as { baseUrl: string | undefined }).baseUrl = savedBaseUrl;
  (appConfig.anthropic as { apiKey: string | undefined }).apiKey = savedAnthropicApiKey;
  (appConfig.google as { apiKey: string | undefined }).apiKey = savedGoogleApiKey;
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
      expect(picker.items[0]).toEqual({ label: "gpt-5-mini", value: "gpt-5-mini" });
      expect(picker.query).toBe("");
      expect(picker.scrollOffset).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("createModelPicker includes openai-compatible models with full id", async () => {
    const originalFetch = globalThis.fetch;
    const originalVercelApiKey = appConfig.vercel.apiKey;
    (appConfig.openai as { apiKey: string | undefined }).apiKey = undefined;
    (appConfig.openai as { baseUrl: string }).baseUrl = "http://localhost:11434/v1";
    (appConfig.vercel as { apiKey: string | undefined }).apiKey = undefined;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ data: [{ id: "qwen2.5-coder:3b" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const picker = await createModelPicker();
      expect(picker.kind).toBe("model");
      if (picker.kind !== "model") throw new Error("Expected model picker");
      expect(picker.items).toEqual([
        { label: "openai-compatible/qwen2.5-coder:3b", value: "openai-compatible/qwen2.5-coder:3b" },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      (appConfig.vercel as { apiKey: string | undefined }).apiKey = originalVercelApiKey;
    }
  });
});
