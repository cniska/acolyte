import { describe, expect, test } from "bun:test";
import { ChatInputPanel } from "./chat-input-panel";
import { palette } from "./palette";
import { renderToString } from "./tui/render-to-string";
import { stripAnsiLength } from "./tui/serialize";
import { withTerminalWidth } from "./tui/test-utils";

function rowWidths(props: Record<string, unknown>, columns: number): number[] {
  const raw = withTerminalWidth(columns, () =>
    renderToString(<ChatInputPanel brandColor={palette.brand} onCursorLine={() => {}} {...props} />),
  );
  return raw.split("\n").map((line) => stripAnsiLength(line));
}

describe("chat input panel suggestion clipping", () => {
  test("clips overflowing @-mention suggestions to the terminal width", () => {
    const widths = rowWidths(
      {
        atQuery: "s",
        atSuggestions: ["src/some/really/long/nested/path/to/a/file/that/overflows.tsx", "short.ts"],
        atSuggestionIndex: 0,
      },
      40,
    );
    for (const width of widths) {
      expect(width).toBeLessThanOrEqual(40);
    }
    expect(Math.max(...widths)).toBe(40);
  });

  test("clips overflowing slash-command suggestions to the terminal width", () => {
    const widths = rowWidths(
      {
        slashSuggestions: ["/some-really-long-slash-command-name-that-overflows", "/help"],
        slashSuggestionIndex: 0,
      },
      40,
    );
    for (const width of widths) {
      expect(width).toBeLessThanOrEqual(40);
    }
  });
});
