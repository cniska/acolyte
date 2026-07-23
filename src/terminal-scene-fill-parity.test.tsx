import { expect, test } from "bun:test";
import type { ReactNode } from "react";
import type { TerminalScene } from "./terminal-scene-contract";
import { TerminalSceneRender } from "./terminal-scene-render";
import { renderToString } from "./tui/render-to-string";
import { TerminalSceneViewport } from "./tui/terminal-scene-viewport";
import { withTerminalWidth } from "./tui/test-utils";

const columns = 40;

// A diff row: leading indent (unpainted) + content span, with a line-level fill role
// whose background paints the content region. `diff-added` carries a background in the
// fixed theme, so the fill actually emits bytes.
const filledScene: TerminalScene = {
  lines: [
    {
      spans: [
        { text: "  ", role: "plain" },
        { text: "+ added line", role: "plain" },
      ],
      fill: "diff-added",
    },
    { spans: [{ text: "plain tail", role: "muted" }] },
  ],
  sections: [{ id: "s", lineStart: 0, lineEnd: 2, finalized: true }],
};

const renderAnsi = (node: ReactNode) => withTerminalWidth(columns, () => renderToString(node));

// The live viewport and the scrollback renderer both delegate to one `renderSceneLines` core,
// so a fill line paints identically in both. This is an anti-fork guard: if a future change
// gives either entry point its own render path, the fill bytes drift and this fails. It does
// not exercise two independent implementations today — there is deliberately only one.
test("the live-tail and scrollback renderers share one fill-painting core", () => {
  // liveLineStart 0 makes the whole scene the live tail, so both calls render the same lines.
  const live = renderAnsi(
    <TerminalSceneViewport scene={filledScene} constraints={{ columns, rows: 10 }} liveLineStart={0} />,
  );
  const scrollback = renderAnsi(<TerminalSceneRender scene={filledScene} />);
  expect(live).toBe(scrollback);
});

test("the fill role changes the emitted bytes, so the shared-core check is non-trivial", () => {
  const unfilledScene: TerminalScene = {
    ...filledScene,
    lines: filledScene.lines.map(({ fill, ...line }) => line),
  };
  const filled = renderAnsi(<TerminalSceneRender scene={filledScene} />);
  const unfilled = renderAnsi(<TerminalSceneRender scene={unfilledScene} />);
  expect(filled).not.toBe(unfilled);
});
