import { describe, expect, test } from "bun:test";
import {
  formatModel,
  isProviderAvailable,
  normalizeModel,
  providerFromModel,
  reasoningProviderOptions,
} from "./provider-config";

describe("provider config", () => {
  test("normalizeModel prefixes unqualified model ids", () => {
    expect(normalizeModel("gpt-5-mini")).toBe("openai/gpt-5-mini");
    expect(normalizeModel("claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4-6");
    expect(normalizeModel("gemini-2.5-pro")).toBe("google/gemini-2.5-pro");
    expect(normalizeModel("openai/gpt-5-mini")).toBe("openai/gpt-5-mini");
  });

  test("formatModel strips provider prefix", () => {
    expect(formatModel("anthropic/claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5-20251001");
    expect(formatModel("openai/gpt-5-mini")).toBe("gpt-5-mini");
    expect(formatModel("openai-compatible/qwen2.5-coder")).toBe("qwen2.5-coder");
    expect(formatModel("custom-model-id")).toBe("custom-model-id");
  });

  test("formatModel appends non-default reasoning level", () => {
    expect(formatModel("openai/o3", "high")).toBe("o3 (high)");
    expect(formatModel("openai/o3", "low")).toBe("o3 (low)");
    expect(formatModel("openai/o3", "medium")).toBe("o3");
    expect(formatModel("openai/o3")).toBe("o3");
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
    expect(providerFromModel("vercel/anthropic/claude-sonnet-4")).toBe("vercel");
    expect(providerFromModel("xai/grok-4.1")).toBe("vercel");
    expect(providerFromModel("mistral/mistral-large")).toBe("vercel");
  });

  test("reasoningProviderOptions returns provider-specific options", () => {
    expect(reasoningProviderOptions("openai", "high")).toEqual({ openai: { reasoningEffort: "high" } });
    expect(reasoningProviderOptions("anthropic", "high")).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 20_000 } },
    });
    expect(reasoningProviderOptions("google", "low")).toEqual({ google: { thinkingConfig: { thinkingLevel: "low" } } });
    expect(reasoningProviderOptions("vercel", "high")).toEqual({ openai: { reasoningEffort: "high" } });
  });

  test("reasoningProviderOptions returns undefined when level is not set", () => {
    expect(reasoningProviderOptions("openai", undefined)).toBeUndefined();
  });

  test("isProviderAvailable validates credential requirements", () => {
    expect(isProviderAvailable("openai", { baseUrl: "https://api.openai.com/v1" })).toBe(false);
    expect(isProviderAvailable("openai", { apiKey: "sk-openai", baseUrl: "https://api.openai.com/v1" })).toBe(true);
    expect(isProviderAvailable("openai", { baseUrl: "http://localhost:11434/v1" })).toBe(true);
    expect(isProviderAvailable("anthropic", { baseUrl: "https://api.anthropic.com/v1" })).toBe(false);
    expect(isProviderAvailable("anthropic", { apiKey: "sk-ant", baseUrl: "https://api.anthropic.com/v1" })).toBe(true);
    expect(isProviderAvailable("anthropic", { apiKey: "sk-ant", baseUrl: "https://api.anthropic.com" })).toBe(false);
    expect(isProviderAvailable("google", { apiKey: "sk-goog" })).toBe(true);
    expect(isProviderAvailable("google", {})).toBe(false);
    expect(isProviderAvailable("vercel", { apiKey: "sk-gw" })).toBe(true);
    expect(isProviderAvailable("vercel", {})).toBe(false);
  });
});
