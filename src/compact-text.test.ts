import { describe, expect, test } from "bun:test";
import { compactText } from "./compact-text";

describe("compactText", () => {
  test("keeps short output unchanged", () => {
    const input = "exit_code=0\nstdout:\nhi";
    expect(compactText(input, { maxChars: 200, maxLines: 20 })).toBe(input);
  });

  test("truncates long output by chars", () => {
    const input = `stdout:\n${"a".repeat(250)}ERRTAIL${"b".repeat(250)}`;
    const result = compactText(input, { maxChars: 120, maxLines: 200 });
    expect(result).toContain("… output truncated");
    expect(result).toContain("aaaa");
    expect(result).toContain("bbbb");
    expect(result.length).toBeLessThanOrEqual(200);
  });

  test("truncates long output by lines", () => {
    const input = Array.from({ length: 50 })
      .map((_, index) => `line-${index}`)
      .join("\n");
    const result = compactText(input, { maxChars: 1000, maxLines: 10 });
    expect(result).toContain("line-6");
    expect(result).toContain("line-49");
    expect(result).not.toContain("line-20");
    expect(result).toContain("lines omitted");
    expect(result).toContain("… output truncated");
  });

  test("does not preserve diff headers (unlike compactToolOutput)", () => {
    const diff = [
      "diff --git a/sum.rs b/sum.rs",
      "--- /dev/null",
      "+++ b/sum.rs",
      "@@ -0,0 +1,80 @@",
      ...Array.from({ length: 80 }, (_, i) => `+ line-${i + 1}`),
    ].join("\n");
    const result = compactText(diff, { maxChars: 120, maxLines: 120 });
    expect(result).toContain("…");
    expect(result.length).toBeLessThanOrEqual(200);
  });
});
