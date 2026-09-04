import { expect, test } from "bun:test";
import {
  BRAND_STOPS,
  CARET_STOPS,
  gradientRgb,
  MONO_CARET_STOPS,
  MONO_STOPS,
  verticalPosition,
} from "./brand-gradient";

test("gradient ends land on the first and last stop", () => {
  expect(gradientRgb(0)).toEqual([196, 181, 253]);
  expect(gradientRgb(1)).toEqual([165, 110, 255]);
});

test("every ramp reads as lit from above, brightest on the top row", () => {
  const luminance = ([r, g, b]: readonly [number, number, number]) => r + g + b;
  for (const stops of [BRAND_STOPS, CARET_STOPS, MONO_STOPS, MONO_CARET_STOPS]) {
    expect(luminance(gradientRgb(1, stops))).toBeLessThan(luminance(gradientRgb(0, stops)));
  }
});

test("a three-stop ramp passes through its middle stop at the midpoint", () => {
  const stops = [
    [0, 0, 0],
    [10, 20, 30],
    [255, 255, 255],
  ] as const;
  expect(gradientRgb(0.5, stops)).toEqual([10, 20, 30]);
});

test("the caret ramp stays deeper than the lettering at every position", () => {
  const luminance = ([r, g, b]: readonly [number, number, number]) => r + g + b;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    expect(luminance(gradientRgb(t, CARET_STOPS))).toBeLessThan(luminance(gradientRgb(t, BRAND_STOPS)));
  }
});

test("the monochrome caret ramp stays deeper than the monochrome lettering", () => {
  const luminance = ([r, g, b]: readonly [number, number, number]) => r + g + b;
  for (const t of [0, 0.5, 1]) {
    expect(luminance(gradientRgb(t, MONO_CARET_STOPS))).toBeLessThan(luminance(gradientRgb(t, MONO_STOPS)));
  }
});

test("positions outside the range clamp to the end stops", () => {
  expect(gradientRgb(-2)).toEqual(gradientRgb(0));
  expect(gradientRgb(4)).toEqual(gradientRgb(1));
});

test("the sweep runs from the top row to the bottom row", () => {
  expect(verticalPosition(0, 6)).toBe(0);
  expect(verticalPosition(5, 6)).toBe(1);
  expect(verticalPosition(3, 6)).toBeGreaterThan(verticalPosition(2, 6));
});

test("a single-row mark does not divide by zero", () => {
  expect(Number.isFinite(verticalPosition(0, 1))).toBe(true);
});
