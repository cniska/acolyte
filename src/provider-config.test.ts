import { describe, expect, test } from "bun:test";
import {
  isProviderAvailable,
  normalizeModel,
  presentModel,
  presentRoleModels,
  providerFromModel,
  resolveProvider,
  resolveRoleModel,
} from "./provider-config";

describe("provider config", () => {
  test("normalizeModel prefixes unqualified model ids", () => {
    expect(normalizeModel("gpt-5-mini")).toBe("openai/gpt-5-mini");
    expect(normalizeModel("openai/gpt-5-mini")).toBe("openai/gpt-5-mini");
  });

  test("resolveRoleModel falls back to requested model", () => {
    expect(resolveRoleModel("planner", "gpt-5-mini", {})).toBe("gpt-5-mini");
  });

  test("resolveRoleModel uses role-specific overrides", () => {
    expect(resolveRoleModel("planner", "gpt-5-mini", { planner: "o3" })).toBe("o3");
    expect(resolveRoleModel("coder", "gpt-5-mini", { coder: "gpt-5-codex" })).toBe("gpt-5-codex");
    expect(resolveRoleModel("reviewer", "gpt-5-mini", { reviewer: "gpt-5" })).toBe("gpt-5");
  });

  test("presentModel and presentRoleModels normalize unqualified ids and preserve qualified ids", () => {
    expect(presentModel("gpt-5-mini")).toBe("openai/gpt-5-mini");
    expect(presentModel("openai-compatible/qwen2.5-coder")).toBe("openai-compatible/qwen2.5-coder");
    expect(presentModel("anthropic/claude-sonnet-4")).toBe("anthropic/claude-sonnet-4");
    expect(presentModel("gemini/gemini-2.5-pro")).toBe("gemini/gemini-2.5-pro");

    expect(
      presentRoleModels({
        main: "gpt-5-mini",
        planner: "openai/o3",
        coder: "anthropic/claude-sonnet-4",
        reviewer: "openai-compatible/qwen2.5-coder",
      }),
    ).toEqual({
      main: "openai/gpt-5-mini",
      planner: "openai/o3",
      coder: "anthropic/claude-sonnet-4",
      reviewer: "openai-compatible/qwen2.5-coder",
    });
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
