import { describe, expect, test } from "bun:test";
import {
  formatModel,
  isProviderAvailable,
  modelDisplayName,
  normalizeModel,
  providerFromModel,
} from "./provider-config";

describe("provider config", () => {
  test("normalizeModel prefixes unqualified model ids", () => {
    expect(normalizeModel("gpt-5-mini")).toBe("openai/gpt-5-mini");
    expect(normalizeModel("claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6");
    expect(normalizeModel("gemini-2.5-pro")).toBe("gemini/gemini-2.5-pro");
    expect(normalizeModel("openai/gpt-5-mini")).toBe("openai/gpt-5-mini");
  });

  test("formatModel strips vendor prefix for display", () => {
    expect(formatModel("openai/gpt-5-mini")).toBe("gpt-5-mini");
    expect(formatModel("anthropic/claude-sonnet-4")).toBe("claude-sonnet-4");
    expect(formatModel("gemini/gemini-2.5-pro")).toBe("gemini-2.5-pro");
    expect(formatModel("openai-compatible/qwen2.5-coder")).toBe("qwen2.5-coder");
    expect(formatModel("gpt-5-mini")).toBe("gpt-5-mini");
  });

  test("modelDisplayName maps known IDs to friendly names", () => {
    expect(modelDisplayName("anthropic/claude-haiku-4-5-20251001")).toBe("claude-haiku-4.5");
    expect(modelDisplayName("claude-sonnet-4-6")).toBe("claude-sonnet-4.6");
    expect(modelDisplayName("openai/gpt-5-mini")).toBe("gpt-5-mini");
    expect(modelDisplayName("custom-model-id")).toBe("custom-model-id");
  });

  test("providerFromModel infers provider from model prefix", () => {
    expect(providerFromModel("gpt-5-mini")).toBe("openai");
    expect(providerFromModel("openai/gpt-5-mini")).toBe("openai");
    expect(providerFromModel("claude-sonnet-4-6")).toBe("anthropic");
    expect(providerFromModel("gemini-2.5-pro")).toBe("gemini");
    expect(providerFromModel("anthropic/claude-sonnet-4")).toBe("anthropic");
    expect(providerFromModel("gemini/gemini-2.5-pro")).toBe("gemini");
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
