import { describe, expect, test } from "bun:test";
import {
  extractFindPatterns,
  extractReadPaths,
  extractSearchPatterns,
  extractSearchScope,
  includesUniversalFindPattern,
  normalizePath,
} from "./tool-arg-paths";

describe("normalizePath", () => {
  test("strips trailing slashes", () => {
    expect(normalizePath("src/")).toBe("src");
    expect(normalizePath("src///")).toBe("src");
  });

  test("strips leading ./", () => {
    expect(normalizePath("./src/foo.ts")).toBe("src/foo.ts");
  });

  test("handles bare filenames", () => {
    expect(normalizePath("foo.ts")).toBe("foo.ts");
  });

  test("handles empty string", () => {
    expect(normalizePath("")).toBe("");
  });
});

describe("extractReadPaths", () => {
  test("extracts paths from object entries", () => {
    expect(extractReadPaths({ paths: [{ path: "src/a.ts" }, { path: "src/b.ts" }] })).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("skips entries missing path key", () => {
    expect(extractReadPaths({ paths: [{ name: "foo" }, { path: "src/a.ts" }] })).toEqual(["src/a.ts"]);
  });

  test("skips non-object entries", () => {
    expect(extractReadPaths({ paths: ["raw", null, 42, { path: "ok.ts" }] })).toEqual(["ok.ts"]);
  });

  test("returns empty for non-array paths", () => {
    expect(extractReadPaths({ paths: "not-an-array" })).toEqual([]);
    expect(extractReadPaths({})).toEqual([]);
  });

  test("normalizes when option set", () => {
    expect(extractReadPaths({ paths: [{ path: "./src/" }] }, { normalize: true })).toEqual(["src"]);
  });

  test("skips empty path strings", () => {
    expect(extractReadPaths({ paths: [{ path: "  " }, { path: "ok.ts" }] })).toEqual(["ok.ts"]);
  });
});

describe("extractSearchPatterns", () => {
  test("normalizes to lowercase", () => {
    expect(extractSearchPatterns({ pattern: "FooBar" })).toEqual(["foobar"]);
  });

  test("strips word boundary markers", () => {
    expect(extractSearchPatterns({ pattern: "\\bfoo\\b" })).toEqual(["foo"]);
  });

  test("strips surrounding quotes", () => {
    expect(extractSearchPatterns({ pattern: '"foo"' })).toEqual(["foo"]);
    expect(extractSearchPatterns({ pattern: "'foo'" })).toEqual(["foo"]);
    expect(extractSearchPatterns({ pattern: "`foo`" })).toEqual(["foo"]);
  });

  test("deduplicates", () => {
    expect(extractSearchPatterns({ pattern: "foo", patterns: ["foo", "bar"] })).toEqual(["bar", "foo"]);
  });

  test("handles both pattern and patterns fields", () => {
    expect(extractSearchPatterns({ pattern: "alpha", patterns: ["beta"] })).toEqual(["alpha", "beta"]);
  });

  test("sorts output", () => {
    expect(extractSearchPatterns({ patterns: ["charlie", "alpha", "bravo"] })).toEqual(["alpha", "bravo", "charlie"]);
  });

  test("skips non-string entries in patterns array", () => {
    expect(extractSearchPatterns({ patterns: [42, "ok", null] })).toEqual(["ok"]);
  });
});

describe("extractSearchScope", () => {
  test("returns workspace sentinel for empty paths", () => {
    expect(extractSearchScope({})).toEqual(["__workspace__"]);
    expect(extractSearchScope({ paths: [] })).toEqual(["__workspace__"]);
  });

  test("normalizes and deduplicates paths", () => {
    expect(extractSearchScope({ paths: ["./src/", "src"] })).toEqual(["src"]);
  });

  test("sorts output", () => {
    expect(extractSearchScope({ paths: ["lib", "src"] })).toEqual(["lib", "src"]);
  });

  test("skips non-string entries", () => {
    expect(extractSearchScope({ paths: [42, "src"] })).toEqual(["src"]);
  });

  test("returns workspace for all-empty entries", () => {
    expect(extractSearchScope({ paths: ["  ", ""] })).toEqual(["__workspace__"]);
  });
});

describe("extractFindPatterns", () => {
  test("normalizes, deduplicates, and sorts", () => {
    expect(extractFindPatterns({ patterns: ["*.TS", "*.ts", "*.js"] })).toEqual(["*.js", "*.ts"]);
  });

  test("returns empty for non-array", () => {
    expect(extractFindPatterns({})).toEqual([]);
    expect(extractFindPatterns({ patterns: "*.ts" })).toEqual([]);
  });

  test("skips non-string and empty entries", () => {
    expect(extractFindPatterns({ patterns: [42, "", "*.ts"] })).toEqual(["*.ts"]);
  });
});

describe("includesUniversalFindPattern", () => {
  test("returns true for * and **/*", () => {
    expect(includesUniversalFindPattern(["*"])).toBe(true);
    expect(includesUniversalFindPattern(["**/*"])).toBe(true);
    expect(includesUniversalFindPattern(["*.ts", "**/*"])).toBe(true);
  });

  test("returns false for specific patterns", () => {
    expect(includesUniversalFindPattern(["*.ts"])).toBe(false);
    expect(includesUniversalFindPattern([])).toBe(false);
  });
});
