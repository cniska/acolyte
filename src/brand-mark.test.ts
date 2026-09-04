import { expect, test } from "bun:test";
import { BRAND_MARK_ROWS, BRAND_WORDMARK_ROWS } from "./brand-mark";

// The art is drawn by hand, so the header's letter and the wordmark's first letter are two
// literals holding one glyph. This catches an edit that lands on only one of them.
test("the header's letter is the wordmark's a", () => {
  const fromWordmark = BRAND_WORDMARK_ROWS.slice(2, 6).map((row) => [...row.word].slice(1, 8).join(""));
  expect(BRAND_MARK_ROWS.map((row) => row.letter)).toEqual(fromWordmark);
});
