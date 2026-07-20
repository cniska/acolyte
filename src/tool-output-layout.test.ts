import { describe, expect, test } from "bun:test";
import type { ToolOutputPart } from "./tool-output-contract";
import { fitLine, layoutToolOutput, resolveHeader, visibleLineWidth } from "./tool-output-layout";

const DIFF_PARTS: ToolOutputPart[] = [
  { kind: "edit-header", labelKey: "tool.label.file_edit", path: "notes.ts", added: 2, removed: 1 },
  { kind: "diff", lineNumber: 9, marker: "context", text: "const x = 1;" },
  { kind: "diff", lineNumber: 10, marker: "remove", text: "const y = 2;" },
  { kind: "diff", lineNumber: 100, marker: "add", text: "X".repeat(80) },
  { kind: "truncated", count: 3, unit: "lines" },
];

const SHELL_PARTS: ToolOutputPart[] = [
  { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "bun test src/really/long/path/module.test.ts" },
  { kind: "shell-output", stream: "stdout", text: "Z".repeat(80) },
  { kind: "shell-output", stream: "stderr", text: "warning".repeat(20) },
];

describe("layoutToolOutput", () => {
  test("computes the gutter width from the widest line number", () => {
    const [, context, , add] = layoutToolOutput(DIFF_PARTS);
    expect(context?.segments[0]?.text).toBe("   9  ");
    expect(add?.segments[0]?.text).toBe(" 100 +");
  });

  test("marks add/remove lines with a fill and leaves context unfilled", () => {
    const [, context, remove, add] = layoutToolOutput(DIFF_PARTS);
    expect(context?.fill).toBeUndefined();
    expect(remove?.fill).toBe("diff-remove");
    expect(add?.fill).toBe("diff-add");
  });

  test("fitLine with no width leaves every line untouched", () => {
    for (const line of layoutToolOutput(DIFF_PARTS)) {
      expect(fitLine(line, undefined)).toEqual(line);
    }
  });
});

describe("fitLine width invariant", () => {
  const scenarios = [DIFF_PARTS, SHELL_PARTS];
  for (const width of [12, 20, 30, 40, 96]) {
    test(`every fitted line fits ${width} columns`, () => {
      for (const parts of scenarios) {
        for (const line of layoutToolOutput(parts)) {
          expect(visibleLineWidth(fitLine(line, width))).toBeLessThanOrEqual(width);
        }
      }
    });
  }
});

describe("resolveHeader", () => {
  test("returns the label for a header part and null otherwise", () => {
    expect(resolveHeader(DIFF_PARTS[0] as ToolOutputPart)?.label).toBeDefined();
    expect(resolveHeader({ kind: "no-output" })).toBeNull();
  });

  test("ignores tool-header state — the marker is a row-level glyph, not a body segment", () => {
    const [header] = layoutToolOutput([
      { kind: "tool-header", labelKey: "tool.label.skill_activate", detail: "build", state: "on" },
    ]);
    expect(header?.segments).toEqual([
      { role: "label", text: "Skill" },
      { role: "detail", text: " build" },
    ]);
  });
});
