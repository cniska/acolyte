import { describe, expect, test } from "bun:test";
import { resolveModelProviderState, resolveRunnableModel } from "./agent-model";

describe("resolveModelProviderState", () => {
  test("marks openai as unavailable without OpenAI credentials on api.openai.com", () => {
    expect(
      resolveModelProviderState("openai/gpt-5-mini", {
        openaiApiKey: undefined,
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toEqual({
      provider: "openai",
      available: false,
    });
  });

  test("maps openai-compatible models to openai provider and stays available without key", () => {
    expect(
      resolveModelProviderState("openai-compatible/qwen2.5-coder", {
        openaiApiKey: undefined,
        openaiBaseUrl: "http://localhost:11434/v1",
      }),
    ).toEqual({
      provider: "openai",
      available: true,
    });
  });

  test("marks anthropic and google availability by provider-specific credentials", () => {
    expect(
      resolveModelProviderState("anthropic/claude-sonnet-4", {
        openaiBaseUrl: "https://api.openai.com/v1",
        anthropicApiKey: undefined,
      }),
    ).toEqual({
      provider: "anthropic",
      available: false,
    });

    expect(
      resolveModelProviderState("google/gemini-2.5-pro", {
        openaiBaseUrl: "https://api.openai.com/v1",
        googleApiKey: "sk-goog",
      }),
    ).toEqual({
      provider: "google",
      available: true,
    });
  });
});

describe("resolveRunnableModel", () => {
  test("returns available when provider has credentials", () => {
    expect(
      resolveRunnableModel("openai/gpt-5-mini", {
        openaiApiKey: "sk-openai",
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toEqual({
      model: "openai/gpt-5-mini",
      provider: "openai",
      available: true,
    });
  });

  test("returns unavailable when provider lacks credentials", () => {
    expect(
      resolveRunnableModel("openai/gpt-5-mini", {
        openaiApiKey: undefined,
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    ).toEqual({
      model: "openai/gpt-5-mini",
      provider: "openai",
      available: false,
    });
  });
});
