import { describe, expect, test } from "bun:test";
import {
  formatToolFileSummaryHeader,
  mergeToolOutputHeader,
  shouldSuppressEmptyToolProgressRow,
} from "./tool-summary-format";

describe("tool summary format", () => {
  test("formats file summary headers for discovery/read tools", () => {
    expect(formatToolFileSummaryHeader("find-files", 3)).toBe("Find 3 files");
    expect(formatToolFileSummaryHeader("search-files", 1)).toBe("Search 1 file");
    expect(formatToolFileSummaryHeader("read-file", 2)).toBe("Read 2 files");
    expect(formatToolFileSummaryHeader("scan-code", 4)).toBe("Review 4 files");
    expect(formatToolFileSummaryHeader("web-search", 1)).toBe("Web Search 1 file");
  });

  test("falls back to generic count for non-discovery tools", () => {
    expect(formatToolFileSummaryHeader("run-command", 4)).toBe("4 files");
  });

  test("merges count and structured lines into full headers", () => {
    expect(mergeToolOutputHeader("Find", "find-files", "scope=workspace patterns=[*.ts] matches=3")).toBe(
      "Find scope=workspace patterns=[*.ts] matches=3",
    );
    expect(
      mergeToolOutputHeader("Search", "search-files", "scope=paths:2 patterns=[tool] matches=2"),
    ).toBe("Search paths:2 [tool]");
    expect(mergeToolOutputHeader("Read", "read-file", "paths=2 targets=[a.ts, b.ts]")).toBe(
      "Read a.ts, b.ts",
    );
    expect(mergeToolOutputHeader("Review", "scan-code", "paths=1 targets=[src/a.ts]")).toBe(
      "Review src/a.ts",
    );
    expect(mergeToolOutputHeader("Create", "create-file", "path=src/a.ts files=1")).toBe(
      "Create path=src/a.ts files=1",
    );
    expect(mergeToolOutputHeader("Edit", "edit-file", "path=src/a.ts files=1 added=2 removed=1")).toBe(
      "Edit path=src/a.ts files=1 added=2 removed=1",
    );
    expect(mergeToolOutputHeader("Find", "find-files", "3 files")).toBe("Find 3 files");
    expect(mergeToolOutputHeader("Find", "find-files", "Find using [tool, agent]")).toBe(
      "Find using [tool, agent]",
    );
    expect(mergeToolOutputHeader("Search", "search-files", "Search 2 files")).toBe("Search 2 files");
    expect(mergeToolOutputHeader("Read", "read-file", "Read 1 file")).toBe("Read 1 file");
    expect(mergeToolOutputHeader("Review", "scan-code", "Review 4 files")).toBe("Review 4 files");
    expect(mergeToolOutputHeader("Search", "search-files", "2 files using 5 patterns")).toBe(
      "Search 2 files using 5 patterns",
    );
    expect(mergeToolOutputHeader("Search", "search-files", "Search 2 files using 1 pattern")).toBe(
      "Search 2 files using 1 pattern",
    );
    expect(mergeToolOutputHeader("Search", "search-files", "Search using [tool, agent]")).toBe(
      "Search using [tool, agent]",
    );
    expect(
      mergeToolOutputHeader("Search", "search-files", "scope=workspace patterns=[any, process.env., foo, bar] matches=4"),
    ).toBe("Search [any, process.env., foo, +1]");
    expect(
      mergeToolOutputHeader("Search", "search-files", "scope=src/ patterns=[any, process.env., foo, bar] matches=4"),
    ).toBe("Search src/ [any, process.env., foo, +1]");
    expect(
      mergeToolOutputHeader(
        "Search",
        "search-files",
        "scope=foo/, bar/, baz, +5 patterns=[any, process.env., alpha, beta, gamma] matches=9",
      ),
    ).toBe("Search foo/, bar/, baz, +5 [any, process.env., alpha, +2]");
    expect(mergeToolOutputHeader("Read", "read-file", "Read a.ts, b.ts, c.ts +2 files")).toBe(
      "Read a.ts, b.ts, c.ts +2 files",
    );
    expect(mergeToolOutputHeader("Review", "scan-code", "Review src/a.ts, src/b.ts")).toBe(
      "Review src/a.ts, src/b.ts",
    );
    expect(mergeToolOutputHeader("Web Search", "web-search", 'query="bun test" results=2')).toBe(
      'Web Search "bun test"',
    );
  });

  test("returns null when line is not a count summary", () => {
    expect(mergeToolOutputHeader("Find", "find-files", "src/a.ts")).toBeNull();
    expect(mergeToolOutputHeader("Run", "run-command", "3 files")).toBeNull();
  });

  test("marks discovery/read/scan tools for empty-row suppression", () => {
    expect(shouldSuppressEmptyToolProgressRow("find-files")).toBe(true);
    expect(shouldSuppressEmptyToolProgressRow("search-files")).toBe(true);
    expect(shouldSuppressEmptyToolProgressRow("read-file")).toBe(true);
    expect(shouldSuppressEmptyToolProgressRow("scan-code")).toBe(true);
    expect(shouldSuppressEmptyToolProgressRow("run-command")).toBe(false);
  });
});
