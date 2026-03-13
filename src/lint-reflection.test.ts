import { describe, expect, test } from "bun:test";
import { type LintCommand, lintFiles } from "./lint-reflection";

const BIOME: LintCommand = { bin: "bunx", args: ["biome", "check"] };

describe("lintFiles", () => {
  test("returns no errors for empty file list", () => {
    const result = lintFiles("/tmp", [], BIOME);
    expect(result.hasErrors).toBe(false);
    expect(result.output).toBe("");
  });

  test("returns no errors for a clean file", () => {
    const result = lintFiles(import.meta.dir, ["lint-reflection.ts"], BIOME);
    expect(result.hasErrors).toBe(false);
  });

  test("treats errors on missing files as lint errors", () => {
    const result = lintFiles(import.meta.dir, ["nonexistent-file.ts"], BIOME);
    // biome exits non-zero for missing files — that's a valid lint error
    expect(result.hasErrors).toBe(true);
  });
});
