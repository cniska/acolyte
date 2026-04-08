import { describe, expect, test } from "bun:test";
import { parseEnv } from "./env";

describe("env parsing", () => {
  test("parseEnv applies defaults", () => {
    const parsed = parseEnv({});
    expect(parsed.ACOLYTE_API_KEY).toBeUndefined();
    expect(parsed.OPENAI_API_KEY).toBeUndefined();
    expect(parsed.ANTHROPIC_API_KEY).toBeUndefined();
    expect(parsed.GOOGLE_API_KEY).toBeUndefined();
    expect(parsed.AI_GATEWAY_API_KEY).toBeUndefined();
  });

  test("parseEnv accepts explicit values", () => {
    const parsed = parseEnv({
      ACOLYTE_API_KEY: "acolyte-token",
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-ant",
      GOOGLE_API_KEY: "sk-goog",
      AI_GATEWAY_API_KEY: "sk-gw",
    });
    expect(parsed.ACOLYTE_API_KEY).toBe("acolyte-token");
    expect(parsed.OPENAI_API_KEY).toBe("sk-openai");
    expect(parsed.ANTHROPIC_API_KEY).toBe("sk-ant");
    expect(parsed.GOOGLE_API_KEY).toBe("sk-goog");
    expect(parsed.AI_GATEWAY_API_KEY).toBe("sk-gw");
  });

  test("parseEnv ignores unknown env keys", () => {
    const parsed = parseEnv({
      ACOLYTE_MODEL: "openai/gpt-5-mini",
      ACOLYTE_API_URL: "http://localhost:6767",
      PORT: "6767",
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      GOOGLE_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
      ACOLYTE_PERMISSION_MODE: "read",
      ACOLYTE_CONTEXT_MAX_TOKENS: "8000",
    } as Record<string, string>);
    expect((parsed as Record<string, unknown>).ACOLYTE_MODEL).toBeUndefined();
    expect((parsed as Record<string, unknown>).ACOLYTE_API_URL).toBeUndefined();
    expect((parsed as Record<string, unknown>).PORT).toBeUndefined();
    expect((parsed as Record<string, unknown>).OPENAI_BASE_URL).toBeUndefined();
    expect((parsed as Record<string, unknown>).ACOLYTE_PERMISSION_MODE).toBeUndefined();
  });
});
