import { describe, expect, test } from "bun:test";
import { findCompletionBlock } from "./lifecycle-completion";

describe("findCompletionBlock — empty-answer", () => {
  test("blocks a turn that ended with no final response", () => {
    expect(findCompletionBlock({ finalText: "   " })).toEqual({ reason: "empty-answer" });
  });

  test("blocks a turn that ended with an empty final response", () => {
    expect(findCompletionBlock({ finalText: "" })).toEqual({ reason: "empty-answer" });
  });

  test("does not fire when the turn wrote a final response", () => {
    expect(findCompletionBlock({ finalText: "Here is the answer." })).toBeUndefined();
  });
});
