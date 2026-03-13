import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appConfig, setModeModel } from "./app-config";
import { resolveModeModel } from "./lifecycle-resolve";

const savedModels = { ...appConfig.models };
const savedOpenai = { ...appConfig.openai };

beforeEach(() => {
  (appConfig as { models: typeof appConfig.models }).models = {};
  Object.assign(appConfig.openai, savedOpenai);
});

afterEach(() => {
  (appConfig as { models: typeof appConfig.models }).models = { ...savedModels };
  Object.assign(appConfig.openai, savedOpenai);
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
