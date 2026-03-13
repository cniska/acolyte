import { describe, expect, test } from "bun:test";
import { colorToBg, colorToFg } from "./styles";

describe("colorToFg", () => {
  test("named color", () => {
    expect(colorToFg("red")).toBe("\x1b[31m");
  });

  test("bright named color", () => {
    expect(colorToFg("redBright")).toBe("\x1b[91m");
  });

  test("case-insensitive fallback", () => {
    expect(colorToFg("Red")).toBe("\x1b[31m");
  });

  test("hex 6-digit", () => {
    expect(colorToFg("#ff8800")).toBe("\x1b[38;2;255;136;0m");
  });

  test("hex 3-digit shorthand", () => {
    expect(colorToFg("#f80")).toBe("\x1b[38;2;255;136;0m");
  });

  test("unknown color returns empty string", () => {
    expect(colorToFg("nope")).toBe("");
  });

  test("invalid hex returns empty string", () => {
    expect(colorToFg("#xyz")).toBe("");
  });
});

describe("colorToBg", () => {
  test("named color", () => {
    expect(colorToBg("blue")).toBe("\x1b[44m");
  });

  test("bright named color", () => {
    expect(colorToBg("whiteBright")).toBe("\x1b[107m");
  });

  test("hex color", () => {
    expect(colorToBg("#000000")).toBe("\x1b[48;2;0;0;0m");
  });
});
