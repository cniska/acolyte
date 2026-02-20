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
  });

  test("parseEnv accepts explicit values", () => {
    const parsed = parseEnv({
      PORT: "9999",
      OPENAI_BASE_URL: "https://example.com/v1",
      ACOLYTE_MODEL: "gpt-5",
      ACOLYTE_OM_MODEL: "gpt-4o-mini",
      ACOLYTE_OM_OBSERVATION_TOKENS: "3500",
      ACOLYTE_OM_REFLECTION_TOKENS: "9000",
    });
    expect(parsed.PORT).toBe(9999);
    expect(parsed.OPENAI_BASE_URL).toBe("https://example.com/v1");
    expect(parsed.ACOLYTE_MODEL).toBe("gpt-5");
    expect(parsed.ACOLYTE_OM_MODEL).toBe("gpt-4o-mini");
    expect(parsed.ACOLYTE_OM_OBSERVATION_TOKENS).toBe(3500);
    expect(parsed.ACOLYTE_OM_REFLECTION_TOKENS).toBe(9000);
  });

  test("parseEnv rejects invalid port", () => {
    expect(() => parseEnv({ PORT: "0" })).toThrow("Invalid environment configuration");
  });
});
