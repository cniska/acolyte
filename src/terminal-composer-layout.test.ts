import { expect, test } from "bun:test";
import { cursorLineIndex } from "./prompt-display";
import { layoutComposerStatus, promptWrapWidth } from "./terminal-chat-layout";

const base = {
  input: { text: "one two three four five six", cursor: 27 },
  placeholder: "Ask",
  focus: true,
  caretVisible: true,
  revision: 0,
  ctrlCPending: false,
  prompt: "chat" as const,
  cursorLine: 0,
  activeIdentity: null,
  picker: null,
  suggestions: { kind: "none" as const },
  showHelp: false,
  helpEntries: [],
  helpBreakpoint: 92,
};

test("composer layout preserves box frame and continuation prompt", () => {
  const scene = layoutComposerStatus({ presentation: base, constraints: { columns: 12, rows: 20 } });
  expect(scene.lines[0]?.spans[1]?.text).toBe(`╭${"─".repeat(20)}╮`);
  expect(scene.lines.at(-1)?.spans[1]?.text).toBe(`╰${"─".repeat(20)}╯`);
  expect(scene.lines[2]?.spans[3]?.text).toBe("  ");
  expect(scene.cursor?.row).toBeGreaterThan(0);
});

test("input handler visual-line math matches the box wrap width", () => {
  // 74 chars of words wraps at the box interior (72 at 80 cols) but not at the pre-box width (78);
  // the handler resolving up/down against promptWrapWidth must agree with the rendered caret.
  const text = "word ".repeat(15).trim();
  const scene = layoutComposerStatus({
    presentation: { ...base, input: { text, cursor: text.length } },
    constraints: { columns: 80, rows: 20 },
  });
  const handlerLine = cursorLineIndex(text, text.length, promptWrapWidth(80));
  expect(handlerLine).toBe(1);
  expect(scene.cursor?.row).toBe(handlerLine + 1);
});

test("composer layout windows picker items", () => {
  const scene = layoutComposerStatus({
    presentation: {
      ...base,
      picker: {
        kind: "model",
        input: { text: "x", cursor: 1 },
        items: [
          { label: "one", value: "one" },
          { label: "two", value: "two" },
        ],
        selected: 1,
        scrollOffset: 0,
        hint: "Enter",
      },
    },
    constraints: { columns: 80, rows: 20 },
  });
  const rendered = scene.lines.map((line) => line.spans.map((span) => span.text).join(""));
  expect(rendered.some((line) => line.includes("│ › two"))).toBe(true);
});
