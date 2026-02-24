import { describe, expect, test } from "bun:test";
import {
  isProviderAvailable,
  normalizeModel,
  presentModel,
  providerFromModel,
  resolveProvider,
} from "./provider-config";

describe("provider config", () => {
  test("normalizeModel prefixes unqualified model ids", () => {
    expect(normalizeModel("gpt-5-mini")).toBe("openai/gpt-5-mini");
    expect(normalizeModel("claude-sonnet-4-5")).toBe("anthropic/claude-sonnet-4-5");
    expect(normalizeModel("gemini-2.5-pro")).toBe("gemini/gemini-2.5-pro");
    expect(normalizeModel("openai/gpt-5-mini")).toBe("openai/gpt-5-mini");
  });

  test("presentModel normalizes unqualified ids and preserves qualified ids", () => {
    expect(presentModel("gpt-5-mini")).toBe("openai/gpt-5-mini");
    expect(presentModel("claude-sonnet-4")).toBe("anthropic/claude-sonnet-4");
    expect(presentModel("gemini-2.5-pro")).toBe("gemini/gemini-2.5-pro");
    expect(presentModel("openai-compatible/qwen2.5-coder")).toBe("openai-compatible/qwen2.5-coder");
    expect(presentModel("anthropic/claude-sonnet-4")).toBe("anthropic/claude-sonnet-4");
    expect(presentModel("gemini/gemini-2.5-pro")).toBe("gemini/gemini-2.5-pro");
  });

  test("resolveProvider detects openai vs openai-compatible vs mock", () => {
    expect(resolveProvider(undefined, "https://api.openai.com/v1")).toBe("mock");
    expect(resolveProvider("sk-test", "https://api.openai.com/v1")).toBe("openai");
    expect(resolveProvider(undefined, "http://localhost:11434/v1")).toBe("openai-compatible");
    expect(resolveProvider("sk-test", "http://localhost:11434/v1")).toBe("openai-compatible");
    expect(resolveProvider("sk-test", "not-a-url")).toBe("openai-compatible");
  });

  test("providerFromModel infers provider from model prefix", () => {
    expect(providerFromModel("gpt-5-mini")).toBe("openai");
    expect(providerFromModel("openai/gpt-5-mini")).toBe("openai");
    expect(providerFromModel("claude-sonnet-4-5")).toBe("anthropic");
    expect(providerFromModel("gemini-2.5-pro")).toBe("gemini");
    expect(providerFromModel("anthropic/claude-sonnet-4")).toBe("anthropic");
    expect(providerFromModel("gemini/gemini-2.5-pro")).toBe("gemini");
    expect(providerFromModel("openai-compatible/qwen2.5-coder")).toBe("openai-compatible");
    expect(providerFromModel(" anthropic/claude-sonnet-4 ")).toBe("anthropic");
  });

  test("isProviderAvailable validates credential requirements", () => {
    expect(
      isProviderAvailable({
        provider: "openai",
        openaiApiKey: undefined,
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toBe(false);
    expect(
      isProviderAvailable({
        provider: "openai",
        openaiApiKey: "sk-openai",
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toBe(true);
    expect(
      isProviderAvailable({
        provider: "openai-compatible",
        openaiApiKey: undefined,
        openaiBaseUrl: "http://localhost:11434/v1",
      }),
    ).toBe(true);
    expect(
      isProviderAvailable({
        provider: "anthropic",
        anthropicApiKey: undefined,
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toBe(false);
    expect(
      isProviderAvailable({
        provider: "anthropic",
        anthropicApiKey: "sk-ant",
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toBe(true);
  });
});
