import { describe, expect, test } from "bun:test";
import { formatDuration, formatRelativeTime, isIsoDateTimeString, nowIso, parseSince } from "./datetime";

describe("isIsoDateTimeString", () => {
  test("accepts valid ISO strings", () => {
    expect(isIsoDateTimeString("2026-03-21T12:00:00Z")).toBe(true);
    expect(isIsoDateTimeString("2026-03-21T12:00:00.000Z")).toBe(true);
  });

  test("rejects invalid values", () => {
    expect(isIsoDateTimeString("not a date")).toBe(false);
    expect(isIsoDateTimeString("")).toBe(false);
    expect(isIsoDateTimeString(42)).toBe(false);
    expect(isIsoDateTimeString(null)).toBe(false);
  });
});

describe("nowIso", () => {
  test("returns a valid ISO string", () => {
    expect(isIsoDateTimeString(nowIso())).toBe(true);
  });
});

describe("formatDuration", () => {
  test("renders ms and s forms", () => {
    expect(formatDuration(240)).toBe("240ms");
    expect(formatDuration(1200)).toBe("1.2s");
    expect(formatDuration(81_900)).toBe("1m 22s");
  });
});

describe("parseSince", () => {
  const now = new Date("2026-03-21T12:00:00Z").getTime();

  test("parses minutes", () => {
    const result = parseSince("5m", now);
    expect(result?.getTime()).toBe(now - 5 * 60_000);
  });

  test("parses hours", () => {
    const result = parseSince("2h", now);
    expect(result?.getTime()).toBe(now - 2 * 3_600_000);
  });

  test("parses days", () => {
    const result = parseSince("1d", now);
    expect(result?.getTime()).toBe(now - 86_400_000);
  });

  test("returns undefined for invalid input", () => {
    expect(parseSince("abc")).toBeUndefined();
    expect(parseSince("5x")).toBeUndefined();
    expect(parseSince("")).toBeUndefined();
    expect(parseSince("m")).toBeUndefined();
  });
});

describe("formatRelativeTime", () => {
  test("returns human-readable relative time", () => {
    const now = new Date("2026-02-26T12:00:00Z").getTime();
    expect(formatRelativeTime("2026-02-26T11:59:30Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-02-26T11:55:00Z", now)).toBe("5m ago");
    expect(formatRelativeTime("2026-02-26T09:00:00Z", now)).toBe("3h ago");
    expect(formatRelativeTime("2026-02-24T12:00:00Z", now)).toBe("2d ago");
  });
});
