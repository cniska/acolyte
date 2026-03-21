import { describe, expect, test } from "bun:test";
import { alignCols, formatCompactNumber } from "./chat-format";

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

describe("alignCols", () => {
  test("aligns columns with padding", () => {
    const out = alignCols([
      ["sess_123", "hello world", "2m ago"],
      ["sess_456789", "test", "1h ago"],
    ]);
    expect(out[0]).toBe("sess_123     hello world  2m ago");
    expect(out[1]).toBe("sess_456789  test         1h ago");
  });
});
