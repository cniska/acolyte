import { describe, expect, test } from "bun:test";
import { parseStatusLine } from "./chat-transcript";

describe("chat transcript helpers", () => {
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
