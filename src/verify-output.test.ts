import { describe, expect, test } from "bun:test";
import { filterOutputByPaths } from "./verify-output";

const workspace = "/Users/test/project";

describe("filterOutputByPaths", () => {
  test("keeps lines matching changed file paths", () => {
    const output = [
      "src/foo.ts(10,5): error TS2304: Cannot find name 'x'.",
      "",
      "",
      "",
      "src/bar.ts(20,3): error TS2304: Cannot find name 'y'.",
      "",
      "",
      "",
      "src/baz.ts(1,1): error TS2304: Cannot find name 'z'.",
    ].join("\n");

    const result = filterOutputByPaths(output, [`${workspace}/src/foo.ts`, `${workspace}/src/baz.ts`], workspace);
    expect(result).toContain("src/foo.ts");
    expect(result).toContain("src/baz.ts");
    expect(result).not.toContain("src/bar.ts");
  });

  test("includes context lines around matches", () => {
    const output = ["line 1", "line 2", "src/changed.ts:5: error here", "line 4", "line 5", "line 6", "line 7"].join(
      "\n",
    );

    const result = filterOutputByPaths(output, [`${workspace}/src/changed.ts`], workspace);
    expect(result).toContain("line 2");
    expect(result).toContain("src/changed.ts:5: error here");
    expect(result).toContain("line 4");
    expect(result).toContain("line 5");
    expect(result).not.toContain("line 7");
  });

  test("returns truncated output when no paths match", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `unrelated line ${i}`);
    const output = lines.join("\n");

    const result = filterOutputByPaths(output, [`${workspace}/src/foo.ts`], workspace);
    expect(result.split("\n").length).toBeLessThanOrEqual(201);
  });

  test("handles empty paths list", () => {
    const output = "some error output";
    const result = filterOutputByPaths(output, [], workspace);
    expect(result).toBe(output);
  });

  test("handles empty output", () => {
    const result = filterOutputByPaths("", [`${workspace}/src/foo.ts`], workspace);
    expect(result).toBe("");
  });

  test("matches relative paths from absolute changed paths", () => {
    const output = "src/deep/nested/file.ts(1,1): error TS2304: missing import";
    const result = filterOutputByPaths(output, [`${workspace}/src/deep/nested/file.ts`], workspace);
    expect(result).toContain("src/deep/nested/file.ts");
  });

  test("handles paths that are already relative to workspace", () => {
    const output = ["src/foo.ts:10: error", "", "", "", "src/bar.ts:20: error"].join("\n");
    const result = filterOutputByPaths(output, [`${workspace}/src/foo.ts`], workspace);
    expect(result).toContain("src/foo.ts");
    expect(result).not.toContain("src/bar.ts");
  });
});
