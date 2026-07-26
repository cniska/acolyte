import { describe, expect, test } from "bun:test";
import { createPathMatcher } from "./glob-match";

const PATHS = [
  "src/agent-toolkit.ts",
  "src/file-toolkit.ts",
  "src/file-ops.ts",
  "src/cli-tool.ts",
  "src/tui/tool-render.tsx",
  "src/tui/components.tsx",
  "docs/tooling.md",
  "package.json",
];

function matched(pattern: string): string[] {
  const matches = createPathMatcher(pattern);
  return PATHS.filter(matches);
}

describe("createPathMatcher", () => {
  test("matches a path prefix combined with a mid-segment wildcard", () => {
    expect(matched("src/*-toolkit.ts")).toEqual(["src/agent-toolkit.ts", "src/file-toolkit.ts"]);
  });

  test("matches a bare wildcard pattern at any depth", () => {
    expect(matched("*-toolkit.ts")).toEqual(["src/agent-toolkit.ts", "src/file-toolkit.ts"]);
  });

  test("matches wildcards on both sides of a fragment within one segment", () => {
    expect(matched("src/*tool*")).toEqual(["src/agent-toolkit.ts", "src/file-toolkit.ts", "src/cli-tool.ts"]);
  });

  test("a single wildcard does not cross a path separator", () => {
    expect(matched("src/*.tsx")).toEqual([]);
  });

  test("double wildcard crosses path separators", () => {
    expect(matched("src/**/*.tsx")).toEqual(["src/tui/tool-render.tsx", "src/tui/components.tsx"]);
  });

  test("an unanchored directory prefix matches nested directories", () => {
    expect(matched("tui/*.tsx")).toEqual(["src/tui/tool-render.tsx", "src/tui/components.tsx"]);
  });

  test("a leading slash anchors the pattern at the workspace root", () => {
    expect(matched("/tui/*.tsx")).toEqual([]);
    expect(matched("/src/*-toolkit.ts")).toEqual(["src/agent-toolkit.ts", "src/file-toolkit.ts"]);
  });

  test("an anchored wildcard-free pattern matches that exact path", () => {
    expect(matched("/src/file-ops.ts")).toEqual(["src/file-ops.ts"]);
  });

  test("a leading slash inside a brace alternative still anchors", () => {
    expect(matched("{/src,/docs}/*.md")).toEqual(["docs/tooling.md"]);
  });

  test("a wildcard-free pattern matches as a substring", () => {
    expect(matched("toolkit")).toEqual(["src/agent-toolkit.ts", "src/file-toolkit.ts"]);
    expect(matched("tool")).toContain("docs/tooling.md");
  });

  test("a wildcard-free path matches exactly one file", () => {
    expect(matched("package.json")).toEqual(["package.json"]);
  });

  test("ignores a leading ./ on the pattern", () => {
    expect(matched("./src/*-toolkit.ts")).toEqual(["src/agent-toolkit.ts", "src/file-toolkit.ts"]);
  });

  test("matches case-insensitively", () => {
    expect(matched("SRC/*-TOOLKIT.TS")).toEqual(["src/agent-toolkit.ts", "src/file-toolkit.ts"]);
    expect(matched("TOOLKIT")).toEqual(["src/agent-toolkit.ts", "src/file-toolkit.ts"]);
  });

  test("matches a character class", () => {
    expect(matched("src/[cf]*.ts")).toEqual(["src/file-toolkit.ts", "src/file-ops.ts", "src/cli-tool.ts"]);
  });

  test("rejects an uncompilable glob", () => {
    expect(() => createPathMatcher("src/[z-a].ts")).toThrow("Invalid glob pattern");
  });

  test("expands brace alternation", () => {
    expect(matched("src/*.{ts,tsx}")).toEqual([
      "src/agent-toolkit.ts",
      "src/file-toolkit.ts",
      "src/file-ops.ts",
      "src/cli-tool.ts",
    ]);
  });

  test("treats a braced pattern without a wildcard as a glob", () => {
    expect(matched("{package,docs}.json")).toEqual(["package.json"]);
  });

  test("expands nested braces", () => {
    expect(matched("{src/{cli,file}-*,docs/*}.ts")).toEqual([
      "src/file-toolkit.ts",
      "src/file-ops.ts",
      "src/cli-tool.ts",
    ]);
  });

  test("leaves an unbalanced brace literal", () => {
    expect(matched("src/{ts*")).toEqual([]);
  });

  test("rejects a pattern with too many brace alternatives", () => {
    const exploded = `${"{a,b}".repeat(7)}*`;
    expect(() => createPathMatcher(exploded)).toThrow("more than 64 alternatives");
  });

  test("does not backtrack on adjacent wildcards", () => {
    const start = Date.now();
    expect(matched(`${"**".repeat(40)}Z`)).toEqual([]);
    expect(Date.now() - start).toBeLessThan(500);
  });

  test("does not backtrack on wildcards separated by literals", () => {
    // As a regex this backtracked superexponentially: 9 of these took 7.8s against one path.
    const subject = [`src/${"a".repeat(50)}b.ts`];
    const start = Date.now();
    expect(subject.filter(createPathMatcher(`${"*a".repeat(12)}Z`))).toEqual([]);
    expect(Date.now() - start).toBeLessThan(500);
  });

  test("repeated star runs still match like a single one", () => {
    expect(matched("src/****/*.tsx")).toEqual(matched("src/**/*.tsx"));
  });

  test("caps the work done, not just the result, for a combinatorial pattern", () => {
    // 2^30 expansions: eager cross-product exhausts memory before any cap can reject it.
    expect(() => createPathMatcher(`${"{a,b}".repeat(30)}*`)).toThrow("more than 64 alternatives");
  });

  test("reports the original pattern when rejecting an expansion", () => {
    expect(() => createPathMatcher("src/{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}*")).toThrow(
      "src/{a,b}{c,d}{e,f}{g,h}{i,j}{k,l}{m,n}*",
    );
  });
});
