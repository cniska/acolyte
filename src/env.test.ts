import { describe, expect, test } from "bun:test";
import { parseEnv } from "./env";

describe("env parsing", () => {
  test("parseEnv applies defaults", () => {
    const parsed = parseEnv({});
    expect(parsed.PORT).toBe(6767);
    expect(parsed.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
    expect(parsed.ACOLYTE_MODEL).toBe("gpt-5-mini");
    expect(parsed.ACOLYTE_OM_OBSERVATION_TOKENS).toBe(3_000);
    expect(parsed.ACOLYTE_OM_REFLECTION_TOKENS).toBe(8_000);
    expect(parsed.ACOLYTE_CONTEXT_MAX_TOKENS).toBe(8_000);
    expect(parsed.ACOLYTE_MAX_HISTORY_MESSAGES).toBe(40);
    expect(parsed.ACOLYTE_MAX_MESSAGE_TOKENS).toBe(600);
    expect(parsed.ACOLYTE_MAX_ATTACHMENT_MESSAGE_TOKENS).toBe(3_000);
    expect(parsed.ACOLYTE_MAX_PINNED_MESSAGE_TOKENS).toBe(1_200);
    expect(parsed.ACOLYTE_PERMISSION_MODE).toBe("read");
  });

  test("parseEnv accepts explicit values", () => {
    const parsed = parseEnv({
      PORT: "9999",
      DATABASE_URL: "postgres://u:p@localhost:5432/acolyte",
      OPENAI_BASE_URL: "https://example.com/v1",
      ACOLYTE_MODEL: "gpt-5",
      ACOLYTE_MODEL_PLANNER: "o3",
      ACOLYTE_MODEL_CODER: "gpt-5-codex",
      ACOLYTE_MODEL_REVIEWER: "gpt-5-mini",
      ACOLYTE_OM_MODEL: "gpt-4o-mini",
      ACOLYTE_OM_OBSERVATION_TOKENS: "3500",
      ACOLYTE_OM_REFLECTION_TOKENS: "9000",
      ACOLYTE_CONTEXT_MAX_TOKENS: "7000",
      ACOLYTE_MAX_HISTORY_MESSAGES: "50",
      ACOLYTE_MAX_MESSAGE_TOKENS: "750",
      ACOLYTE_MAX_ATTACHMENT_MESSAGE_TOKENS: "4500",
      ACOLYTE_MAX_PINNED_MESSAGE_TOKENS: "1600",
      ACOLYTE_PERMISSION_MODE: "read",
    });
    expect(parsed.PORT).toBe(9999);
    expect(parsed.DATABASE_URL).toBe("postgres://u:p@localhost:5432/acolyte");
    expect(parsed.OPENAI_BASE_URL).toBe("https://example.com/v1");
    expect(parsed.ACOLYTE_MODEL).toBe("gpt-5");
    expect(parsed.ACOLYTE_MODEL_PLANNER).toBe("o3");
    expect(parsed.ACOLYTE_MODEL_CODER).toBe("gpt-5-codex");
    expect(parsed.ACOLYTE_MODEL_REVIEWER).toBe("gpt-5-mini");
    expect(parsed.ACOLYTE_OM_MODEL).toBe("gpt-4o-mini");
    expect(parsed.ACOLYTE_OM_OBSERVATION_TOKENS).toBe(3500);
    expect(parsed.ACOLYTE_OM_REFLECTION_TOKENS).toBe(9000);
    expect(parsed.ACOLYTE_CONTEXT_MAX_TOKENS).toBe(7000);
    expect(parsed.ACOLYTE_MAX_HISTORY_MESSAGES).toBe(50);
    expect(parsed.ACOLYTE_MAX_MESSAGE_TOKENS).toBe(750);
    expect(parsed.ACOLYTE_MAX_ATTACHMENT_MESSAGE_TOKENS).toBe(4500);
    expect(parsed.ACOLYTE_MAX_PINNED_MESSAGE_TOKENS).toBe(1600);
    expect(parsed.ACOLYTE_PERMISSION_MODE).toBe("read");
  });

  test("parseEnv rejects invalid port", () => {
    expect(() => parseEnv({ PORT: "0" })).toThrow("Invalid environment configuration");
  });

  test("parseEnv rejects oversized token budgets", () => {
    expect(() => parseEnv({ ACOLYTE_CONTEXT_MAX_TOKENS: "1000000" })).toThrow("Invalid environment configuration");
    expect(() => parseEnv({ ACOLYTE_OM_OBSERVATION_TOKENS: "50000" })).toThrow("Invalid environment configuration");
    expect(() => parseEnv({ ACOLYTE_MAX_MESSAGE_TOKENS: "50000" })).toThrow("Invalid environment configuration");
  });
});
