import { describe, expect, test } from "bun:test";
import { createRunControl } from "./lifecycle-contract";

describe("createRunControl", () => {
  test("defaults to no yield and a signal that never aborts", () => {
    const rc = createRunControl();
    expect(rc.shouldYield()).toBe(false);
    expect(rc.signal.aborted).toBe(false);
  });

  test("accepts partial overrides", () => {
    const rc = createRunControl({ shouldYield: () => true });
    expect(rc.shouldYield()).toBe(true);
    expect(rc.signal.aborted).toBe(false);
  });

  test("accepts full overrides", () => {
    const rc = createRunControl({ shouldYield: () => true, signal: AbortSignal.abort() });
    expect(rc.shouldYield()).toBe(true);
    expect(rc.signal.aborted).toBe(true);
  });
});
