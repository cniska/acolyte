import { describe, expect, test } from "bun:test";
import { clampToTokenEstimate, splitScopedObservation } from "./memory-ops";

describe("clampToTokenEstimate", () => {
  test("does not produce lone surrogates when clamping emoji text", () => {
    const mixed = "a🎉".repeat(200);
    const result = clampToTokenEstimate(mixed, 5);
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(result).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});

describe("splitScopedObservation", () => {
  test("parses scoped observations into facts", () => {
    const result = splitScopedObservation("@observe project\nuses bun\n@observe user\nprefers terse output");
    expect(result.projectCount).toBe(1);
    expect(result.userCount).toBe(1);
    expect(result.facts).toHaveLength(2);
    expect(result.facts[0]).toMatchObject({ scope: "project", content: "uses bun" });
  });

  test("drops untagged lines without a preceding @observe", () => {
    const result = splitScopedObservation("orphan line\n@observe session\ntagged line");
    expect(result.droppedUntaggedCount).toBe(1);
    expect(result.sessionCount).toBe(1);
  });

  test("drops malformed @observe directives", () => {
    const result = splitScopedObservation("@observe badscope\nfollowing line");
    expect(result.droppedMalformedCount).toBe(1);
    expect(result.droppedUntaggedCount).toBe(1);
    expect(result.facts).toHaveLength(0);
  });

  test("handles @observe at end of input with no content", () => {
    const result = splitScopedObservation("@observe project");
    expect(result.facts).toHaveLength(0);
    expect(result.projectCount).toBe(0);
  });

  test("handles @topic directive", () => {
    const result = splitScopedObservation("@observe project\n@topic testing\nuses bun test");
    expect(result.facts[0]).toMatchObject({ scope: "project", content: "uses bun test", topic: "testing" });
  });

  test("@topic without preceding @observe — content is dropped as untagged", () => {
    const result = splitScopedObservation("@topic orphan\nsome content");
    expect(result.droppedUntaggedCount).toBe(1);
    expect(result.facts).toHaveLength(0);
  });

  test("multiple @observe in sequence — only last one applies", () => {
    const result = splitScopedObservation("@observe project\n@observe user\nactual fact");
    expect(result.userCount).toBe(1);
    expect(result.projectCount).toBe(0);
  });
});
