import { describe, expect, test } from "bun:test";
import { parseImplementedFeatures } from "./chat-features";

describe("chat-features", () => {
  test("parseImplementedFeatures reads implemented bullet list", () => {
    const markdown = [
      "# Title",
      "",
      "## Implemented",
      "",
      "- First feature",
      "- Second feature",
      "",
      "## Planned",
      "- Later",
    ].join("\n");
    expect(parseImplementedFeatures(markdown, 8)).toEqual(["First feature", "Second feature"]);
  });
});
