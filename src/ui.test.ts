import { describe, expect, test } from "bun:test";
import { tokenizeStreamContent } from "./ui";

describe("ui stream helpers", () => {
  test("tokenizeStreamContent preserves whitespace tokens including newlines", () => {
    const tokens = tokenizeStreamContent("• 1. first\n2. second");
    expect(tokens).toEqual(["•", " ", "1.", " ", "first", "\n", "2.", " ", "second"]);
  });
});
