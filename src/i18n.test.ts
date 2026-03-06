import { describe, expect, test } from "bun:test";
import { t } from "./i18n";

describe("i18n", () => {
  test("returns plain message for key without placeholders", () => {
    expect(t("chat.tokens.none")).toBe("No token data yet. Send a prompt first.");
  });

  test("interpolates placeholder values", () => {
    expect(t("chat.resume.not_found", { prefix: "sess_abc" })).toBe("No session found for prefix: sess_abc");
    expect(t("chat.model.changed.mode", { mode: "plan", model: "gpt-5-mini" })).toBe(
      "Changed plan mode model to gpt-5-mini.",
    );
  });

  test("renders boolean/number placeholders", () => {
    expect(t("chat.sessions.header", { count: 3 })).toBe("Sessions 3");
  });
});
