import { beforeEach, describe, expect, test } from "bun:test";
import { appConfig, setModeModel } from "./app-config";
import { readResolvedConfigSync } from "./config";
import { resolveModeModel } from "./lifecycle-resolve";

function resetAppConfigForTest(): void {
  const defaults = readResolvedConfigSync({ homeDir: "/__acolyte_test_reset__", cwd: "/__acolyte_test_reset__" });
  (appConfig as { model: string }).model = defaults.model;
  (appConfig as { models: Record<string, string | undefined> }).models = {};
  Object.assign(appConfig.server, {
    port: defaults.port,
    transportMode: defaults.transportMode,
    replyTimeoutMs: defaults.replyTimeoutMs,
  });
  Object.assign(appConfig.openai, { baseUrl: defaults.openaiBaseUrl });
  Object.assign(appConfig.anthropic, { baseUrl: defaults.anthropicBaseUrl });
  Object.assign(appConfig.google, { baseUrl: defaults.googleBaseUrl });
}

beforeEach(() => {
  resetAppConfigForTest();
});

function withOpenaiKey(key: string | undefined): void {
  (appConfig.openai as { apiKey: string | undefined }).apiKey = key;
}

describe("resolveModeModel", () => {
  test("returns requestModel when no mode-specific model configured", () => {
    withOpenaiKey("sk-test");
    const result = resolveModeModel("work", "openai/gpt-5-mini");
    expect(result.model).toBe("openai/gpt-5-mini");
  });

  test("prefers appConfig mode model over requestModel", () => {
    withOpenaiKey("sk-test");
    setModeModel("verify", "openai/gpt-5-mini");
    const result = resolveModeModel("verify", "openai/gpt-5");
    expect(result.model).toBe("openai/gpt-5-mini");
  });

  test("request modeModels override takes highest priority", () => {
    withOpenaiKey("sk-test");
    setModeModel("work", "openai/gpt-5");
    const result = resolveModeModel("work", "openai/gpt-5", { work: "openai/gpt-5-mini" });
    expect(result.model).toBe("openai/gpt-5-mini");
  });

  test("empty modeModels override falls through to next tier", () => {
    withOpenaiKey("sk-test");
    const result = resolveModeModel("work", "openai/gpt-5-mini", { work: "  " });
    expect(result.model).toBe("openai/gpt-5-mini");
  });

  test("throws E_MODEL_NOT_CONFIGURED when all sources empty", () => {
    expect(() => resolveModeModel("work", "")).toThrow();
    try {
      resolveModeModel("work", "");
    } catch (error) {
      expect((error as { code: string }).code).toBe("E_MODEL_NOT_CONFIGURED");
    }
  });

  test("throws E_MODEL_PROVIDER_UNAVAILABLE when provider unavailable", () => {
    withOpenaiKey(undefined);
    try {
      resolveModeModel("work", "openai/gpt-5-mini");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { code: string }).code).toBe("E_MODEL_PROVIDER_UNAVAILABLE");
    }
  });
});
