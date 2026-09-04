import { expect, test } from "bun:test";
import { gradientRgb, MONO_CARET_STOPS, MONO_STOPS, verticalPosition } from "./brand-gradient";

const luminance = ([r, g, b]: readonly [number, number, number]) => r + g + b;

test("gradient ends land on the first and last stop", () => {
  expect(gradientRgb(0, MONO_STOPS)).toEqual([245, 245, 245]);
  expect(gradientRgb(1, MONO_STOPS)).toEqual([163, 163, 163]);
});

test("a three-stop ramp passes through its middle stop at the midpoint", () => {
  const stops = [
    [0, 0, 0],
    [10, 20, 30],
    [255, 255, 255],
  ] as const;
  expect(gradientRgb(0.5, stops)).toEqual([10, 20, 30]);
});

test("every ramp reads as lit from above, brightest on the top row", () => {
  for (const stops of [MONO_STOPS, MONO_CARET_STOPS]) {
    expect(luminance(gradientRgb(1, stops))).toBeLessThan(luminance(gradientRgb(0, stops)));
  }
});

test("the caret ramp stays deeper than the lettering at every position", () => {
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    expect(luminance(gradientRgb(t, MONO_CARET_STOPS))).toBeLessThan(luminance(gradientRgb(t, MONO_STOPS)));
  }
});

test("positions outside the range clamp to the end stops", () => {
  expect(gradientRgb(-2, MONO_STOPS)).toEqual(gradientRgb(0, MONO_STOPS));
  expect(gradientRgb(4, MONO_STOPS)).toEqual(gradientRgb(1, MONO_STOPS));
});

test("the sweep runs from the top row to the bottom row", () => {
  expect(verticalPosition(0, 6)).toBe(0);
  expect(verticalPosition(5, 6)).toBe(1);
  expect(verticalPosition(3, 6)).toBeGreaterThan(verticalPosition(2, 6));
});

test("a single-row mark does not divide by zero", () => {
  expect(Number.isFinite(verticalPosition(0, 1))).toBe(true);
});
