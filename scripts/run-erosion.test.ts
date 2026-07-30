import { describe, expect, test } from "bun:test";
import { isSourceFile, parseErosionArgs } from "./run-erosion";

describe("parseErosionArgs", () => {
  test("defaults to src with no flags", () => {
    expect(parseErosionArgs([])).toEqual({
      paths: ["src"],
      includeTests: false,
      json: false,
      top: 10,
      tags: false,
      limit: null,
    });
  });

  test("collects positional paths", () => {
    expect(parseErosionArgs(["src/tui", "scripts"]).paths).toEqual(["src/tui", "scripts"]);
  });

  test("reads the flags it supports", () => {
    const args = parseErosionArgs(["--tags", "--json", "--include-tests", "--top", "3", "--limit", "5"]);
    expect(args).toEqual({ paths: ["src"], includeTests: true, json: true, top: 3, tags: true, limit: 5 });
  });

  test("accepts a top of zero to suppress the ranking", () => {
    expect(parseErosionArgs(["--top", "0"]).top).toBe(0);
  });

  test("rejects an unknown flag", () => {
    expect(() => parseErosionArgs(["--nope"])).toThrow("unknown flag: --nope");
  });

  test("rejects a non-numeric or missing top", () => {
    expect(() => parseErosionArgs(["--top", "many"])).toThrow("--top requires a non-negative number");
    expect(() => parseErosionArgs(["--top"])).toThrow("--top requires a non-negative number");
  });

  test("rejects a negative top", () => {
    expect(() => parseErosionArgs(["--top", "-1"])).toThrow("--top requires a non-negative number");
  });

  test("rejects a limit below one", () => {
    expect(() => parseErosionArgs(["--limit", "0"])).toThrow("--limit requires a positive number");
    expect(() => parseErosionArgs(["--limit"])).toThrow("--limit requires a positive number");
  });
});

describe("isSourceFile", () => {
  test("accepts TypeScript sources", () => {
    expect(isSourceFile("src/chat-state.ts", false)).toBe(true);
    expect(isSourceFile("src/tui/render.tsx", false)).toBe(true);
  });

  test("rejects declarations and non-TypeScript files", () => {
    expect(isSourceFile("src/globals.d.ts", false)).toBe(false);
    expect(isSourceFile("src/notes.md", false)).toBe(false);
    expect(isSourceFile("scripts/release.sh", false)).toBe(false);
  });

  test("excludes tests unless asked for them", () => {
    for (const file of ["src/a.test.ts", "src/a.test.tsx", "src/a.int.test.ts"]) {
      expect(isSourceFile(file, false)).toBe(false);
      expect(isSourceFile(file, true)).toBe(true);
    }
  });
});
