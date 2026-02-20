import { describe, expect, test } from "bun:test";
import { moveWordLeft, moveWordRight } from "./prompt-input";

describe("prompt input word navigation", () => {
  test("moveWordLeft jumps to previous word start", () => {
    const value = "run verify now";
    expect(moveWordLeft(value, value.length)).toBe(11); // now
    expect(moveWordLeft(value, 11)).toBe(4); // verify
    expect(moveWordLeft(value, 4)).toBe(0); // run
  });

  test("moveWordRight jumps to next word end", () => {
    const value = "run verify now";
    expect(moveWordRight(value, 0)).toBe(3);
    expect(moveWordRight(value, 4)).toBe(10);
    expect(moveWordRight(value, 11)).toBe(14);
  });
});
