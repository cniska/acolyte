import { describe, expect, test } from "bun:test";
import type { LanguageModelV4FunctionTool, LanguageModelV4Message } from "@ai-sdk/provider";
import {
  applyPromptCacheMarkers,
  createPromptCacheKey,
  mergeProviderOptions,
  promptCacheProviderOptions,
  withVercelPromptCacheFetch,
} from "./prompt-cache";

describe("prompt cache", () => {
  test("creates stable opaque cache keys", () => {
    const first = createPromptCacheKey({ model: "openai/gpt-5-mini", sessionId: "sess_1", workspace: "/repo" });
    const second = createPromptCacheKey({ model: "openai/gpt-5-mini", sessionId: "sess_1", workspace: "/repo" });
    const other = createPromptCacheKey({ model: "openai/gpt-5-mini", sessionId: "sess_2", workspace: "/repo" });

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^acolyte-[a-f0-9]{32}$/);
  });

  test("merges provider options by provider key", () => {
    expect(
      mergeProviderOptions(
        { openai: { reasoningEffort: "high" }, anthropic: { cacheControl: { type: "ephemeral" } } },
        { openai: { promptCacheKey: "cache-key" }, gateway: { caching: "auto" } },
      ),
    ).toEqual({
      openai: { reasoningEffort: "high", promptCacheKey: "cache-key" },
      anthropic: { cacheControl: { type: "ephemeral" } },
      gateway: { caching: "auto" },
    });
  });

  test("returns provider request options for supported providers", () => {
    expect(promptCacheProviderOptions("openai", "cache-key")).toEqual({
      openai: { promptCacheKey: "cache-key" },
    });
    expect(promptCacheProviderOptions("vercel", "cache-key")).toEqual({
      gateway: { caching: "auto" },
      openai: { promptCacheKey: "cache-key" },
    });
    expect(promptCacheProviderOptions("google", "cache-key")).toBeUndefined();
  });

  test("marks Anthropic system prompt and final tool definition as cacheable", () => {
    const messages: LanguageModelV4Message[] = [
      { role: "system", content: "stable instructions" },
      { role: "user", content: [{ type: "text", text: "dynamic prompt" }] },
    ];
    const tools: LanguageModelV4FunctionTool[] = [
      { type: "function", name: "file-read", description: "read", inputSchema: {} },
      { type: "function", name: "file-search", description: "search", inputSchema: {} },
    ];

    applyPromptCacheMarkers("anthropic", messages, tools);

    expect(messages[0].providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
    expect(tools[0].providerOptions).toBeUndefined();
    expect(tools[1].providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
  });

  test("injects Vercel gateway automatic caching into OpenAI-compatible requests", async () => {
    let capturedBody: unknown;
    const fetchFn = (async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;

    await withVercelPromptCacheFetch(fetchFn)("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "anthropic/claude-sonnet-4", messages: [] }),
    });

    expect(capturedBody).toEqual({
      model: "anthropic/claude-sonnet-4",
      messages: [],
      providerOptions: { gateway: { caching: "auto" } },
    });
  });
});
