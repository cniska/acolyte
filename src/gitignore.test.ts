import { describe, expect, test } from "bun:test";
import { compileGitignorePatterns, isIgnoredByPatterns } from "./gitignore";

function makeCtx(dir: string, lines: string[]) {
  return { dir, patterns: compileGitignorePatterns(lines) };
}

function ignored(lines: string[], path: string, isDir = false): boolean {
  return isIgnoredByPatterns([makeCtx("/repo", lines)], `/repo/${path}`, isDir);
}

describe("comments and blank lines", () => {
  test("ignores blank lines", () => {
    expect(ignored(["", "  "], "foo.ts")).toBe(false);
  });

  test("ignores comment lines", () => {
    expect(ignored(["# this is a comment", "*.log"], "foo.ts")).toBe(false);
  });

  test("escaped hash is a literal pattern", () => {
    expect(ignored(["\\#special"], "#special")).toBe(true);
  });
});

describe("literal patterns", () => {
  test("matches exact filename anywhere in tree", () => {
    expect(ignored([".env"], ".env")).toBe(true);
    expect(ignored([".env"], "src/.env")).toBe(true);
  });

  test("does not match partial filename", () => {
    expect(ignored([".env"], ".envrc")).toBe(false);
  });
});

describe("wildcard *", () => {
  test("matches any filename with extension", () => {
    expect(ignored(["*.log"], "error.log")).toBe(true);
    expect(ignored(["*.log"], "logs/error.log")).toBe(true);
  });

  test("does not cross directory boundary", () => {
    expect(ignored(["*.log"], "logs/sub/error.log")).toBe(true);
    expect(ignored(["src/*.ts"], "src/foo.ts")).toBe(true);
    expect(ignored(["src/*.ts"], "src/sub/foo.ts")).toBe(false);
  });

  test("matches prefix wildcard", () => {
    expect(ignored(["foo*"], "foobar")).toBe(true);
    expect(ignored(["foo*"], "foo")).toBe(true);
    expect(ignored(["foo*"], "bar")).toBe(false);
  });
});

describe("wildcard ?", () => {
  test("matches exactly one character", () => {
    expect(ignored(["fo?"], "foo")).toBe(true);
    expect(ignored(["fo?"], "fo")).toBe(false);
    expect(ignored(["fo?"], "fooo")).toBe(false);
  });

  test("does not match path separator", () => {
    expect(ignored(["a?b"], "a/b")).toBe(false);
  });
});

describe("double star **", () => {
  test("leading **/ matches in any directory", () => {
    expect(ignored(["**/logs"], "logs", true)).toBe(true);
    expect(ignored(["**/logs"], "src/logs", true)).toBe(true);
    expect(ignored(["**/logs"], "a/b/logs", true)).toBe(true);
  });

  test("trailing /** matches everything inside", () => {
    expect(ignored(["src/**"], "src/foo.ts")).toBe(true);
    expect(ignored(["src/**"], "src/sub/foo.ts")).toBe(true);
  });

  test("internal /**/ matches zero or more directories", () => {
    expect(ignored(["a/**/b"], "a/b")).toBe(true);
    expect(ignored(["a/**/b"], "a/x/b")).toBe(true);
    expect(ignored(["a/**/b"], "a/x/y/b")).toBe(true);
  });
});

describe("anchored patterns", () => {
  test("leading slash anchors to root", () => {
    expect(ignored(["/dist"], "dist", true)).toBe(true);
    expect(ignored(["/dist"], "src/dist", true)).toBe(false);
  });

  test("pattern with internal slash anchors to root", () => {
    expect(ignored(["src/generated"], "src/generated", true)).toBe(true);
    expect(ignored(["src/generated"], "lib/src/generated", true)).toBe(false);
  });
});

describe("directory-only patterns", () => {
  test("trailing slash matches directories only", () => {
    expect(ignored(["dist/"], "dist", true)).toBe(true);
    expect(ignored(["dist/"], "dist", false)).toBe(false);
  });

  test("trailing slash with wildcard", () => {
    expect(ignored(["*.tmp/"], "cache.tmp", true)).toBe(true);
    expect(ignored(["*.tmp/"], "cache.tmp", false)).toBe(false);
  });
});

describe("negation", () => {
  test("negation re-includes a previously ignored path", () => {
    expect(ignored(["*.log", "!important.log"], "important.log")).toBe(false);
    expect(ignored(["*.log", "!important.log"], "error.log")).toBe(true);
  });

  test("later positive pattern overrides negation", () => {
    expect(ignored(["*.log", "!important.log", "important.log"], "important.log")).toBe(true);
  });

  test("negation does not affect unrelated paths", () => {
    // dist/ is a dirOnly pattern — it matches the directory, not files inside it.
    // Files inside an ignored directory are excluded by traversal, not by pattern matching.
    // A negation can re-include a specific file ignored by a non-dirOnly pattern.
    expect(ignored(["dist/**", "!dist/keep.ts"], "dist/other.ts", false)).toBe(true);
    expect(ignored(["dist/**", "!dist/keep.ts"], "dist/keep.ts", false)).toBe(false);
  });
});

describe("character classes", () => {
  test("matches characters in class", () => {
    expect(ignored(["file[123].ts"], "file1.ts")).toBe(true);
    expect(ignored(["file[123].ts"], "file2.ts")).toBe(true);
    expect(ignored(["file[123].ts"], "file4.ts")).toBe(false);
  });

  test("range in class", () => {
    expect(ignored(["file[a-z].ts"], "filea.ts")).toBe(true);
    expect(ignored(["file[a-z].ts"], "fileA.ts")).toBe(false);
  });
});

describe("nested gitignore contexts", () => {
  test("child context applies only within its directory", () => {
    const root = makeCtx("/repo", ["*.log"]);
    const child = makeCtx("/repo/src", ["*.generated.ts"]);
    const contexts = [root, child];

    expect(isIgnoredByPatterns(contexts, "/repo/error.log", false)).toBe(true);
    expect(isIgnoredByPatterns(contexts, "/repo/src/foo.generated.ts", false)).toBe(true);
    expect(isIgnoredByPatterns(contexts, "/repo/lib/foo.generated.ts", false)).toBe(false);
  });

  test("child negation does not affect root patterns", () => {
    const root = makeCtx("/repo", ["*.log"]);
    const child = makeCtx("/repo/src", ["!error.log"]);
    const contexts = [root, child];

    // Root-level log is ignored by root pattern; child negation only applies within /repo/src
    expect(isIgnoredByPatterns(contexts, "/repo/error.log", false)).toBe(true);
    expect(isIgnoredByPatterns(contexts, "/repo/src/error.log", false)).toBe(false);
  });
});
