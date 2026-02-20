import { describe, expect, test } from "bun:test";
import { parseEnv } from "./env";

describe("env parsing", () => {
  test("parseEnv applies defaults", () => {
    const parsed = parseEnv({});
    expect(parsed.PORT).toBe(8787);
    expect(parsed.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
    expect(parsed.ACOLYTE_MODEL).toBe("gpt-5-mini");
  });

  test("parseEnv accepts explicit values", () => {
    const parsed = parseEnv({
      PORT: "9999",
      OPENAI_BASE_URL: "https://example.com/v1",
      ACOLYTE_MODEL: "gpt-5",
      ACOLYTE_OM_MODEL: "gpt-4o-mini",
    });
    expect(parsed.PORT).toBe(9999);
    expect(parsed.OPENAI_BASE_URL).toBe("https://example.com/v1");
    expect(parsed.ACOLYTE_MODEL).toBe("gpt-5");
    expect(parsed.ACOLYTE_OM_MODEL).toBe("gpt-4o-mini");
  });

  test("parseEnv rejects invalid port", () => {
    expect(() => parseEnv({ PORT: "0" })).toThrow("Invalid environment configuration");
  });
});
