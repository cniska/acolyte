import { describe, expect, test } from "bun:test";
import { parseToolOutputMarker, parseToolOutputRow, TextToolOutputParser } from "./tool-output-parser";

describe("tool output parser", () => {
  const parser = new TextToolOutputParser();

  test("parses find summary rows", () => {
    expect(parseToolOutputRow("find-files", "scope=workspace patterns=[*.ts, *.md] matches=3")).toEqual({
      kind: "find-summary",
      scope: "workspace",
      patterns: ["*.ts", "*.md"],
      matches: 3,
    });
  });

  test("parses search summary rows", () => {
    expect(parser.parseRow("search-files", "scope=src/, docs/ patterns=[tool, agent] matches=2")).toEqual({
      kind: "search-summary",
      scope: "src/, docs/",
      patterns: ["tool", "agent"],
      matches: 2,
    });
  });

  test("parses read/scan summary rows", () => {
    expect(parseToolOutputRow("read-file", "paths=4 targets=[a.ts, b.ts, c.ts] omitted=1")).toEqual({
      kind: "read-summary",
      paths: 4,
      targets: ["a.ts", "b.ts", "c.ts"],
      omitted: 1,
    });
    expect(parseToolOutputRow("scan-code", "paths=1 targets=[src/a.ts]")).toEqual({
      kind: "read-summary",
      paths: 1,
      targets: ["src/a.ts"],
      omitted: 0,
    });
  });

  test("parses web/create/edit summaries", () => {
    expect(parseToolOutputRow("web-search", 'query="bun test" results=2')).toEqual({
      kind: "web-search-summary",
      query: '"bun test"',
      results: 2,
    });
    expect(parseToolOutputRow("create-file", "path=src/a.ts files=1")).toEqual({
      kind: "create-summary",
      path: "src/a.ts",
      files: 1,
    });
    expect(parseToolOutputRow("edit-file", "path=src/a.ts files=1 added=2 removed=1")).toEqual({
      kind: "edit-summary",
      path: "src/a.ts",
      files: 1,
      added: 2,
      removed: 1,
    });
  });

  test("parses generic markers", () => {
    expect(parseToolOutputMarker("[no-output]")).toEqual({ kind: "no-output" });
    expect(parseToolOutputMarker("[truncated]")).toEqual({ kind: "truncated", count: 0 });
    expect(parseToolOutputMarker("[truncated] +3")).toEqual({ kind: "truncated", count: 3, unit: undefined });
    expect(parseToolOutputMarker("[truncated] +2 lines")).toEqual({ kind: "truncated", count: 2, unit: "lines" });
    expect(parseToolOutputMarker("plain")).toEqual({ kind: "none" });
  });
});
