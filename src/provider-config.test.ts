import { describe, expect, test } from "bun:test";
import {
  forcesToolChoice,
  formatModel,
  isProviderAvailable,
  modelCreator,
  normalizeModel,
  providerFromModel,
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

  test("modelCreator sees through the Vercel gateway to the model family", () => {
    expect(modelCreator("openai/gpt-5.2")).toBe("openai");
    expect(modelCreator("vercel/openai/gpt-5.2")).toBe("openai");
    expect(modelCreator("vercel/anthropic/claude-sonnet-4")).toBe("anthropic");
    expect(modelCreator("gpt-5.2")).toBe("openai");
    expect(modelCreator("claude-sonnet-4-6")).toBe("anthropic");
    expect(modelCreator("google/gemini-2.5-pro")).toBe("google");
    expect(modelCreator("xai/grok-4.1")).toBe("vercel");
  });

  test("forcesToolChoice forces the OpenAI/harmony family, native or gateway-routed", () => {
    // Regression for the #303 gap: gateway-routed GPT classifies as "vercel" but must still
    // be forced, or signal_done leaks as text and degenerates into garbage tokens.
    expect(forcesToolChoice("vercel/openai/gpt-5.2")).toBe(true);
    expect(forcesToolChoice("openai/gpt-5.2")).toBe(true);
    expect(forcesToolChoice("gpt-5.2")).toBe(true);
    // Gateway Anthropic must stay auto: forced choice becomes a prefill that 400s under thinking.
    expect(forcesToolChoice("vercel/anthropic/claude-sonnet-4")).toBe(false);
    expect(forcesToolChoice("claude-sonnet-4-6")).toBe(false);
    expect(forcesToolChoice("google/gemini-2.5-pro")).toBe(false);
    expect(forcesToolChoice("vercel/google/gemini-2.5-pro")).toBe(false);
    // Gateway families Acolyte doesn't model first-class must not be force-decoded.
    expect(forcesToolChoice("xai/grok-4.1")).toBe(false);
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
