import { describe, expect, test } from "bun:test";
import { resolveModelProviderState, resolveRunnableModel } from "./agent-model";

describe("resolveModelProviderState", () => {
  test("marks openai as unavailable without OpenAI credentials on api.openai.com", () => {
    expect(
      resolveModelProviderState("openai/gpt-5-mini", {
        openai: { baseUrl: "https://api.openai.com/v1" },
      }),
    ).toEqual({
      provider: "openai",
      available: false,
    });
  });

  test("maps openai-compatible models to openai provider and stays available without key", () => {
    expect(
      resolveModelProviderState("openai-compatible/qwen2.5-coder", {
        openai: { baseUrl: "http://localhost:11434/v1" },
      }),
    ).toEqual({
      provider: "openai",
      available: true,
    });
  });

  test("marks anthropic and google availability by provider-specific credentials", () => {
    expect(
      resolveModelProviderState("anthropic/claude-sonnet-4", {}),
    ).toEqual({
      provider: "anthropic",
      available: false,
    });

    expect(
      resolveModelProviderState("google/gemini-2.5-pro", {
        google: { apiKey: "sk-goog" },
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
        openai: { apiKey: "sk-openai", baseUrl: "https://api.openai.com/v1" },
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
        openai: { baseUrl: "https://api.openai.com/v1" },
      }),
    ).toEqual({
      model: "openai/gpt-5-mini",
      provider: "openai",
      available: false,
    });
  });
});
