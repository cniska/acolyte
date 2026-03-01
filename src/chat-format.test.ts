import { describe, expect, test } from "bun:test";
import { formatChangesSummary, formatColumns, formatRelativeTime, formatThoughtDuration } from "./chat-format";

describe("chat-formatters helpers", () => {
  test("formatThoughtDuration renders ms and s forms", () => {
    expect(formatThoughtDuration(240)).toBe("240ms");
    expect(formatThoughtDuration(1200)).toBe("1.2s");
    expect(formatThoughtDuration(81_900)).toBe("1m 22s");
  });

  test("formatChangesSummary renders git status and diff totals", () => {
    const status = ["## main...origin/main", " M src/cli.ts", "?? src/new.ts"].join("\n");
    const diff = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "-old", "+new", "+another"].join("\n");
    const out = formatChangesSummary(status, diff);
    expect(out).toContain("2 changed files.");
    expect(out).toContain("## main...origin/main");
    expect(out).toContain("Diff summary: +2 -1.");
  });

  test("formatChangesSummary handles singular changed-file count", () => {
    const status = ["## main...origin/main", " M src/cli.ts"].join("\n");
    const diff = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "-old", "+new"].join("\n");
    const out = formatChangesSummary(status, diff);
    expect(out).toContain("1 changed file.");
  });

  test("formatChangesSummary falls back to diff file count when status is missing", () => {
    const status = "";
    const diff = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "-old", "+new", "+another"].join("\n");
    const out = formatChangesSummary(status, diff);
    expect(out).toContain("1 changed file.");
    expect(out).toContain("Diff summary: +2 -1.");
  });

  test("formatColumns aligns columns with padding", () => {
    const out = formatColumns([
      ["sess_123", "hello world", "2m ago"],
      ["sess_456789", "test", "1h ago"],
    ]);
    expect(out[0]).toBe("sess_123     hello world  2m ago");
    expect(out[1]).toBe("sess_456789  test         1h ago");
  });

  test("formatRelativeTime returns human-readable relative time", () => {
    const now = new Date("2026-02-26T12:00:00Z").getTime();
    expect(formatRelativeTime("2026-02-26T11:59:30Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-02-26T11:55:00Z", now)).toBe("5m ago");
    expect(formatRelativeTime("2026-02-26T09:00:00Z", now)).toBe("3h ago");
    expect(formatRelativeTime("2026-02-24T12:00:00Z", now)).toBe("2d ago");
  });
});
