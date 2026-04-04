import { beforeEach, describe, expect, test } from "bun:test";
import { appConfig } from "./app-config";
import { resolveModel } from "./lifecycle-resolve";

const SAVED_OPENAI_KEY = appConfig.openai.apiKey;
const SAVED_VERCEL_KEY = appConfig.vercel.apiKey;

beforeEach(() => {
  (appConfig.openai as { apiKey: string | undefined }).apiKey = SAVED_OPENAI_KEY;
  (appConfig.vercel as { apiKey: string | undefined }).apiKey = SAVED_VERCEL_KEY;
});

describe("resolveModel", () => {
  test("returns request model when configured and provider is available", () => {
    (appConfig.openai as { apiKey: string | undefined }).apiKey = "sk-test";
    const result = resolveModel("openai/gpt-5-mini");
    expect(result.model).toBe("openai/gpt-5-mini");
  });

  test("throws E_MODEL_NOT_CONFIGURED when request model is empty", () => {
    expect(() => resolveModel("")).toThrow();
    try {
      resolveModel("");
    } catch (error) {
      expect((error as { code: string }).code).toBe("E_MODEL_NOT_CONFIGURED");
    }
  });

  test("throws E_MODEL_PROVIDER_UNAVAILABLE when provider unavailable", () => {
    (appConfig.openai as { apiKey: string | undefined }).apiKey = undefined;
    (appConfig.vercel as { apiKey: string | undefined }).apiKey = undefined;
    try {
      resolveModel("openai/gpt-5-mini");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { code: string }).code).toBe("E_MODEL_PROVIDER_UNAVAILABLE");
    }
  });
});
