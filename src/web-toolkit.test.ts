import { describe, expect, test } from "bun:test";
import { webSearchStreamRows } from "./web-toolkit";

describe("webSearchStreamRows", () => {
  test("converts web search prose output into machine rows", () => {
    const raw = [
      "Web results for: bun test",
      "1. Bun runtime docs",
      "   https://bun.sh/docs",
      "   Fast all-in-one JavaScript runtime and toolkit.",
    ].join("\n");
    expect(webSearchStreamRows(raw)).toBe(
      ['query="bun test" results=1', 'result rank=1 url="https://bun.sh/docs"'].join("\n"),
    );
  });

  test("converts no-results output into summary + no-output marker", () => {
    expect(webSearchStreamRows("No web results found for: missing query")).toBe(
      ['query="missing query" results=0', "(No output)"].join("\n"),
    );
  });

  test("limits rows to top five results and emits truncated marker", () => {
    const raw = [
      "Web results for: acolyte",
      "1. One",
      "   https://one.test",
      "2. Two",
      "   https://two.test",
      "3. Three",
      "   https://three.test",
      "4. Four",
      "   https://four.test",
      "5. Five",
      "   https://five.test",
      "6. Six",
      "   https://six.test",
      "7. Seven",
      "   https://seven.test",
    ].join("\n");

    expect(webSearchStreamRows(raw)).toBe(
      [
        'query="acolyte" results=7',
        'result rank=1 url="https://one.test"',
        'result rank=2 url="https://two.test"',
        'result rank=3 url="https://three.test"',
        'result rank=4 url="https://four.test"',
        'result rank=5 url="https://five.test"',
        "… +2 results",
      ].join("\n"),
    );
  });
});
