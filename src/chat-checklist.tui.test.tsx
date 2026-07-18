import { describe, expect, test } from "bun:test";
import { ChatChecklist } from "./chat-checklist";
import { createRow } from "./chat-contract";
import { renderToString } from "./tui/render-to-string";
import { stripAnsiLength } from "./tui/serialize";
import { withTerminalWidth } from "./tui/test-utils";

describe("chat checklist clipping", () => {
  test("clips long checklist items to the terminal width", () => {
    const row = createRow("status", {
      groupId: "g1",
      groupTitle: "Implementation tasks",
      items: [
        {
          id: "a",
          label: "Wire the overflow prop end-to-end across the serialize pass and every box layout path",
          status: "in_progress",
          order: 0,
        },
        { id: "b", label: "Short one", status: "done", order: 1 },
      ],
    });
    const raw = withTerminalWidth(40, () => renderToString(<ChatChecklist rows={[row]} />));
    const widths = raw.split("\n").map((line) => stripAnsiLength(line));
    for (const width of widths) {
      expect(width).toBeLessThanOrEqual(40);
    }
    // The overflowing item is clipped up to the full width, not left short or wrapped.
    expect(Math.max(...widths)).toBe(40);
  });
});
