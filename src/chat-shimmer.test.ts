import { describe, expect, test } from "bun:test";
import { shimmerColor } from "./chat-shimmer";

describe("shimmerColor", () => {
  test("returns valid hex color", () => {
    const color = shimmerColor(5, 5, 12);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("center of sweep is brightest", () => {
    const center = shimmerColor(10, 10, 12);
    const edge = shimmerColor(0, 10, 12);
    // center should have higher channel values (brighter)
    const centerVal = Number.parseInt(center.slice(1, 3), 16);
    const edgeVal = Number.parseInt(edge.slice(1, 3), 16);
    expect(centerVal).toBeGreaterThan(edgeVal);
  });

  test("far from sweep returns dim base", () => {
    const far = shimmerColor(0, 50, 12);
    expect(far).toBe("#555555");
  });

  test("handles frame 0 and max frame", () => {
    expect(shimmerColor(0, -12, 12)).toMatch(/^#[0-9a-f]{6}$/);
    expect(shimmerColor(0, 100, 12)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
