import { describe, expect, test } from "bun:test";
import { t } from "./i18n";

describe("i18n", () => {
  test("returns plain message for key without placeholders", () => {
    expect(t("chat.usage.none")).toBe("No usage data yet. Send a prompt first.");
  });

  test("interpolates placeholder values", () => {
    expect(t("chat.resume.not_found", { prefix: "sess_abc" })).toBe("No session found for prefix: sess_abc");
    expect(t("chat.model.changed", { model: "gpt-5-mini" })).toBe("Changed model to gpt-5-mini.");
  });

  test("renders boolean/number placeholders", () => {
    expect(t("chat.sessions.header", { count: 3 })).toBe("Sessions 3");
  });

  test("pluralizes with .one variant when count is 1", () => {
    expect(t("unit.file", { count: 1 })).toBe("1 file");
    expect(t("unit.file", { count: 0 })).toBe("0 files");
    expect(t("unit.file", { count: 3 })).toBe("3 files");
  });

  test("pluralizes irregular forms", () => {
    expect(t("unit.match", { count: 1 })).toBe("1 match");
    expect(t("unit.match", { count: 5 })).toBe("5 matches");
  });
});
