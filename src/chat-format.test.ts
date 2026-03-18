import { describe, expect, test } from "bun:test";
import { alignCols, formatCompactNumber, formatRelativeTime, formatThoughtDuration } from "./chat-format";

describe("formatCompactNumber", () => {
  test("returns raw number below 1000", () => {
    expect(formatCompactNumber(0)).toBe("0");
    expect(formatCompactNumber(999)).toBe("999");
  });

  test("formats 1k–99.9k with one decimal", () => {
    expect(formatCompactNumber(1000)).toBe("1.0k");
    expect(formatCompactNumber(1500)).toBe("1.5k");
    expect(formatCompactNumber(48600)).toBe("48.6k");
    expect(formatCompactNumber(99900)).toBe("99.9k");
  });

  test("rounds to whole k at 100k boundary", () => {
    expect(formatCompactNumber(99950)).toBe("100k");
    expect(formatCompactNumber(100000)).toBe("100k");
    expect(formatCompactNumber(150000)).toBe("150k");
  });
});

describe("chat-formatters helpers", () => {
  test("formatThoughtDuration renders ms and s forms", () => {
    expect(formatThoughtDuration(240)).toBe("240ms");
    expect(formatThoughtDuration(1200)).toBe("1.2s");
    expect(formatThoughtDuration(81_900)).toBe("1m 22s");
  });

  test("alignCols aligns columns with padding", () => {
    const out = alignCols([
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
