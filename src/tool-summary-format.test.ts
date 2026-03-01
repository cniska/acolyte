import { describe, expect, test } from "bun:test";
import {
  formatToolFileSummaryHeader,
  normalizeToolFileSummaryHeader,
  shouldSuppressEmptyToolProgressRow,
} from "./tool-summary-format";

describe("tool summary format", () => {
  test("formats file summary headers for discovery/read tools", () => {
    expect(formatToolFileSummaryHeader("find-files", 3)).toBe("Find 3 files");
    expect(formatToolFileSummaryHeader("search-files", 1)).toBe("Search 1 file");
    expect(formatToolFileSummaryHeader("read-file", 2)).toBe("Read 2 files");
    expect(formatToolFileSummaryHeader("scan-code", 4)).toBe("Scan 4 files");
  });

  test("falls back to generic count for non-discovery tools", () => {
    expect(formatToolFileSummaryHeader("run-command", 4)).toBe("4 files");
  });

  test("normalizes count lines into full headers for merge", () => {
    expect(normalizeToolFileSummaryHeader("Find", "find-files", "3 files")).toBe("Find 3 files");
    expect(normalizeToolFileSummaryHeader("Find", "find-files", "Find using [tool, agent]")).toBe(
      "Find using [tool, agent]",
    );
    expect(normalizeToolFileSummaryHeader("Search", "search-files", "Search 2 files")).toBe("Search 2 files");
    expect(normalizeToolFileSummaryHeader("Read", "read-file", "Read 1 file")).toBe("Read 1 file");
    expect(normalizeToolFileSummaryHeader("Scan", "scan-code", "Scan 4 files")).toBe("Scan 4 files");
    expect(normalizeToolFileSummaryHeader("Search", "search-files", "2 files using 5 patterns")).toBe(
      "Search 2 files using 5 patterns",
    );
    expect(normalizeToolFileSummaryHeader("Search", "search-files", "Search 2 files using 1 pattern")).toBe(
      "Search 2 files using 1 pattern",
    );
    expect(normalizeToolFileSummaryHeader("Search", "search-files", "Search using [tool, agent]")).toBe(
      "Search using [tool, agent]",
    );
    expect(normalizeToolFileSummaryHeader("Read", "read-file", "Read a.ts, b.ts, c.ts +2 files")).toBe(
      "Read a.ts, b.ts, c.ts +2 files",
    );
    expect(normalizeToolFileSummaryHeader("Scan", "scan-code", "Scan src/a.ts, src/b.ts")).toBe(
      "Scan src/a.ts, src/b.ts",
    );
  });

  test("returns null when line is not a count summary", () => {
    expect(normalizeToolFileSummaryHeader("Find", "find-files", "src/a.ts")).toBeNull();
    expect(normalizeToolFileSummaryHeader("Run", "run-command", "3 files")).toBeNull();
  });

  test("marks discovery/read/scan tools for empty-row suppression", () => {
    expect(shouldSuppressEmptyToolProgressRow("find-files")).toBe(true);
    expect(shouldSuppressEmptyToolProgressRow("search-files")).toBe(true);
    expect(shouldSuppressEmptyToolProgressRow("read-file")).toBe(true);
    expect(shouldSuppressEmptyToolProgressRow("scan-code")).toBe(true);
    expect(shouldSuppressEmptyToolProgressRow("run-command")).toBe(false);
  });
});
