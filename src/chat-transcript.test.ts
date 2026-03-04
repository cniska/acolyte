import { describe, expect, test } from "bun:test";
import { parseSessionsHeader, parseStatusLine } from "./chat-transcript";
import { parseToolProgressBlock, parseToolProgressLine } from "./tool-progress";

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

  test("parseToolProgressLine parses edit headers", () => {
    expect(parseToolProgressLine("Edit src/main.ts")).toEqual({
      kind: "header",
      label: "Edit",
      detail: "src/main.ts",
    });
  });

  test("parseToolProgressLine parses run headers", () => {
    expect(parseToolProgressLine("Run rustc ./sum.rs -o ./sum && ./sum 1 2 3 4")).toEqual({
      kind: "header",
      label: "Run",
      detail: "rustc ./sum.rs -o ./sum && ./sum 1 2 3 4",
    });
  });

  test("parseToolProgressLine parses numbered diff lines", () => {
    expect(parseToolProgressLine("12 + const x = 1;")).toEqual({
      kind: "numberedDiff",
      lineNumber: "12",
      spacing: " ",
      marker: "+",
      text: "const x = 1;",
    });
  });

  test("parseToolProgressLine parses numbered context lines", () => {
    expect(parseToolProgressLine("8  unchanged line")).toEqual({
      kind: "numberedContext",
      lineNumber: "8",
      spacing: "  ",
      text: "unchanged line",
    });
  });

  test("parseToolProgressBlock classifies edit output as diff", () => {
    const block = parseToolProgressBlock("Edit src/main.ts\n5  const a = 1;\n6 +const b = 2;\n… +3 lines");
    expect(block.kind).toBe("diff");
    expect(block.header).toEqual({ label: "Edit", detail: "src/main.ts" });
    expect(block.lines).toHaveLength(3);
    expect(block.lineNumberWidth).toBe(3);
  });

  test("parseToolProgressBlock classifies run output as command", () => {
    const block = parseToolProgressBlock("Run bun test\nout | 3 pass\nerr | warning\n… +5 lines");
    expect(block.kind).toBe("command");
    expect(block.header).toEqual({ label: "Run", detail: "bun test" });
    expect(block.lines).toHaveLength(3);
  });

  test("parseToolProgressBlock classifies search output as plain", () => {
    const block = parseToolProgressBlock("Search *.ts\nsrc/main.ts\nsrc/cli.ts");
    expect(block.kind).toBe("plain");
    expect(block.lines).toHaveLength(2);
  });
});
