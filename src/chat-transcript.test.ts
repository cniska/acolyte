import { describe, expect, test } from "bun:test";
import { parseSessionsHeader, parseStatusLine } from "./chat-transcript";

describe("chat transcript helpers", () => {
  test("parseSessionsHeader reads session count and body", () => {
    const parsed = parseSessionsHeader(["Sessions 12", "", "● sess_abc  title"].join("\n"));
    expect(parsed).toEqual({
      prefix: "Sessions ",
      count: "12",
      rest: "\n● sess_abc  title",
    });
  });

  test("parseSessionsHeader returns null for non-session headings", () => {
    expect(parseSessionsHeader("Status 12")).toBeNull();
  });

  test("parseStatusLine parses key-value lines with optional indentation", () => {
    expect(parseStatusLine("providers: openai")).toEqual({
      indent: "",
      key: "providers: ",
      value: "openai",
    });
    expect(parseStatusLine("  api_url: https://api.openai.com/v1")).toEqual({
      indent: "  ",
      key: "api_url: ",
      value: "https://api.openai.com/v1",
    });
  });

  test("parseStatusLine returns null for non key-value lines", () => {
    expect(parseStatusLine("plain text line")).toBeNull();
    expect(parseStatusLine("")).toBeNull();
  });
});
