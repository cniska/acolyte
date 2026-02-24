import { describe, expect, test } from "bun:test";
import { compactToolOutput } from "./tool-output";

describe("compactToolOutput", () => {
  test("keeps short output unchanged", () => {
    const input = "exit_code=0\nstdout:\nhi";
    expect(compactToolOutput(input, { maxChars: 200, maxLines: 20 })).toBe(input);
  });

  test("truncates long output by chars", () => {
    const input = `stdout:\n${"a".repeat(250)}ERRTAIL${"b".repeat(250)}`;
    const result = compactToolOutput(input, { maxChars: 120, maxLines: 200 });
    expect(result).toContain("… output truncated");
    expect(result).toContain("aaaa");
    expect(result).toContain("bbbb");
    expect(result.length).toBeLessThanOrEqual(200);
  });

  test("truncates long output by lines", () => {
    const input = Array.from({ length: 50 })
      .map((_, index) => `line-${index}`)
      .join("\n");
    const result = compactToolOutput(input, { maxChars: 1000, maxLines: 10 });
    expect(result).toContain("line-6");
    expect(result).toContain("line-49");
    expect(result).not.toContain("line-20");
    expect(result).toContain("lines omitted");
    expect(result).toContain("… output truncated");
  });
});
