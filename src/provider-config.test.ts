import { describe, expect, test } from "bun:test";
import { formatModel, isProviderAvailable, normalizeModel, providerFromModel } from "./provider-config";

describe("provider config", () => {
  test("normalizeModel prefixes unqualified model ids", () => {
    expect(normalizeModel("gpt-5-mini")).toBe("openai/gpt-5-mini");
    expect(normalizeModel("claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6");
    expect(normalizeModel("gemini-2.5-pro")).toBe("google/gemini-2.5-pro");
    expect(normalizeModel("openai/gpt-5-mini")).toBe("openai/gpt-5-mini");
  });

  test("formatModel maps known IDs to friendly names and strips prefix", () => {
    expect(formatModel("anthropic/claude-haiku-4-5-20251001")).toBe("claude-haiku-4.5");
    expect(formatModel("claude-sonnet-4-6")).toBe("claude-sonnet-4.6");
    expect(formatModel("openai/gpt-5-mini")).toBe("gpt-5-mini");
    expect(formatModel("openai-compatible/qwen2.5-coder")).toBe("qwen2.5-coder");
    expect(formatModel("custom-model-id")).toBe("custom-model-id");
  });

  test("providerFromModel infers provider from model prefix", () => {
    expect(providerFromModel("gpt-5-mini")).toBe("openai");
    expect(providerFromModel("openai/gpt-5-mini")).toBe("openai");
    expect(providerFromModel("claude-sonnet-4-6")).toBe("anthropic");
    expect(providerFromModel("gemini-2.5-pro")).toBe("google");
    expect(providerFromModel("anthropic/claude-sonnet-4")).toBe("anthropic");
    expect(providerFromModel("google/gemini-2.5-pro")).toBe("google");
    expect(providerFromModel("openai-compatible/qwen2.5-coder")).toBe("openai");
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
        provider: "openai",
        openaiApiKey: undefined,
        openaiBaseUrl: "http://localhost:11434/v1",
      }),
    ).toBe(true);
    expect(
      isProviderAvailable({
        provider: "anthropic",
        anthropicApiKey: undefined,
        openaiBaseUrl: "https://api.openai.com/v1",
        anthropicBaseUrl: "https://api.anthropic.com/v1",
      }),
    ).toBe(false);
    expect(
      isProviderAvailable({
        provider: "anthropic",
        anthropicApiKey: "sk-ant",
        openaiBaseUrl: "https://api.openai.com/v1",
        anthropicBaseUrl: "https://api.anthropic.com/v1",
      }),
    ).toBe(true);
    expect(
      isProviderAvailable({
        provider: "anthropic",
        anthropicApiKey: "sk-ant",
        openaiBaseUrl: "https://api.openai.com/v1",
        anthropicBaseUrl: "https://api.anthropic.com",
      }),
    ).toBe(false);
  });
});
