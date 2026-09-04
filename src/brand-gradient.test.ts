import { expect, test } from "bun:test";
import { diagonalPosition, gradientRgb } from "./brand-gradient";

test("gradient ends land on the first and last stop", () => {
  expect(gradientRgb(0)).toEqual([103, 69, 164]);
  expect(gradientRgb(1)).toEqual([196, 181, 253]);
});

test("gradient passes through brand purple at the midpoint", () => {
  expect(gradientRgb(0.5)).toEqual([165, 110, 255]);
});

test("positions outside the range clamp to the end stops", () => {
  expect(gradientRgb(-2)).toEqual(gradientRgb(0));
  expect(gradientRgb(4)).toEqual(gradientRgb(1));
});

test("the diagonal runs corner to corner with both axes weighted equally", () => {
  expect(diagonalPosition(0, 0, 10, 6)).toBe(0);
  expect(diagonalPosition(9, 5, 10, 6)).toBe(1);
  expect(diagonalPosition(9, 0, 10, 6)).toBe(diagonalPosition(0, 5, 10, 6));
});

test("a single-column or single-row mark does not divide by zero", () => {
  expect(Number.isFinite(diagonalPosition(0, 0, 1, 1))).toBe(true);
});
