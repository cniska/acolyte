import { describe, expect, test } from "bun:test";
import { createRunControl } from "./lifecycle-contract";

describe("createRunControl", () => {
  test("defaults to no-op callbacks", () => {
    const rc = createRunControl();
    expect(rc.shouldYield()).toBe(false);
    expect(rc.isCancelled()).toBe(false);
  });

  test("accepts partial overrides", () => {
    const rc = createRunControl({ shouldYield: () => true });
    expect(rc.shouldYield()).toBe(true);
    expect(rc.isCancelled()).toBe(false);
  });

  test("accepts full overrides", () => {
    const rc = createRunControl({ shouldYield: () => true, isCancelled: () => true });
    expect(rc.shouldYield()).toBe(true);
    expect(rc.isCancelled()).toBe(true);
  });
});
