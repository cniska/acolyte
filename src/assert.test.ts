import { describe, expect, test } from "bun:test";
import { invariant, unreachable } from "./assert";

describe("assert helpers", () => {
  test("invariant does not throw when condition is truthy", () => {
    expect(() => invariant(true, "should not throw")).not.toThrow();
  });

  test("invariant throws default message when condition is falsy", () => {
    expect(() => invariant(false)).toThrow("Invariant violation");
  });

  test("invariant throws provided message when condition is falsy", () => {
    expect(() => invariant(false, "Oops")).toThrow("Oops");
  });

  test("unreachable always throws with rendered value", () => {
    expect(() => unreachable("unexpected" as never)).toThrow("Unreachable: unexpected");
  });
});
