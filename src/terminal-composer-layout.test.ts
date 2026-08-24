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
};

test("composer layout preserves box frame and continuation prompt", () => {
  const scene = layoutComposerStatus({ presentation: base, constraints: { columns: 12, rows: 20 } });
  // Below the clamped minimum interior the box keeps its own width rather than the terminal's, so
  // the rule spans the interior the rows pad to and the corners still meet the vertical borders.
  expect(scene.lines[0]?.spans[1]?.text).toBe(`╭${"─".repeat(26)}╮`);
  expect(scene.lines.at(-1)?.spans[1]?.text).toBe(`╰${"─".repeat(26)}╯`);
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

test("ghost text shows the prefix remainder in its own role, distinct from typed input", () => {
  const scene = layoutComposerStatus({
    presentation: {
      ...base,
      input: { text: "/st", cursor: 3 },
      suggestions: { kind: "slash", candidates: [{ command: "/status" }], selected: 0 },
    },
    constraints: { columns: 80, rows: 20 },
  });
  // Caret sits at the insertion point — on the ghost's first char (`a`) inverse; `tus` trails faint.
  const promptLine = scene.lines.find((line) => line.spans.some((span) => span.role === "ghost"));
  const typed = promptLine?.spans.find((span) => span.text === "/st");
  const caret = promptLine?.spans.find((span) => span.text === "a" && span.role === "cursor");
  const ghost = promptLine?.spans.find((span) => span.text === "tus");
  expect(typed?.role).toBe("plain");
  expect(caret).toBeDefined();
  expect(ghost?.role).toBe("ghost");
});

test("a bare trigger ghosts nothing until a fragment is typed", () => {
  // Typing just `/` or `@` must not guess (and must not pin the caret on the trigger char).
  for (const input of ["/", "@"] as const) {
    const kind = input === "/" ? "slash" : "at";
    const scene = layoutComposerStatus({
      presentation: {
        ...base,
        input: { text: input, cursor: 1 },
        suggestions:
          kind === "slash"
            ? { kind: "slash", candidates: [{ command: "/status" }], selected: 0 }
            : {
                kind: "at",
                query: "",
                candidates: [{ label: "src/chat-state.ts", value: "src/chat-state.ts" }],
                selected: 0,
                noMatches: false,
              },
      },
      constraints: { columns: 80, rows: 20 },
    });
    expect(scene.lines.some((line) => line.spans.some((span) => span.role === "ghost"))).toBe(false);
  }
});

test("a fuzzy (non-prefix) suggestion ghosts nothing", () => {
  const scene = layoutComposerStatus({
    presentation: {
      ...base,
      input: { text: "/he", cursor: 3 },
      suggestions: { kind: "slash", candidates: [{ command: "/new" }], selected: 0 },
    },
    constraints: { columns: 80, rows: 20 },
  });
  expect(scene.lines.some((line) => line.spans.some((span) => span.role === "ghost"))).toBe(false);
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

test("help keys are laid out in three column-major columns", () => {
  const entries = Array.from({ length: 14 }, (_, index) => ({ key: `k${index}`, description: `does thing ${index}` }));
  const scene = layoutComposerStatus({
    presentation: { ...base, showHelp: true, helpEntries: entries },
    constraints: { columns: 200, rows: 40 },
  });
  const rows = scene.lines.slice(-5).map((line) => line.spans.map((span) => span.text).join(""));
  expect(rows).toHaveLength(5);
  // Column-major: the first column holds the first five entries, the next column resumes at the sixth.
  expect(rows[0]).toContain("k0 does thing 0");
  expect(rows[0]).toContain("k5 does thing 5");
  expect(rows[0]).toContain("k10 does thing 10");
  expect(rows[4]).toContain("k4 does thing 4");
  expect(rows[4]).not.toContain("k14");
});

test("every column starts at the same offset, whatever the entries beside it", () => {
  // Six entries fill three columns of two rows; the first column's rows differ wildly in length.
  const entries = [
    { key: "a", description: "short" },
    { key: "b", description: "a considerably longer description than its neighbour" },
    { key: "c", description: "second column one" },
    { key: "d", description: "second column two" },
    { key: "e", description: "third one" },
    { key: "f", description: "third two" },
  ];
  const scene = layoutComposerStatus({
    presentation: { ...base, showHelp: true, helpEntries: entries },
    constraints: { columns: 200, rows: 40 },
  });
  const rows = scene.lines.slice(-2).map((line) => line.spans.map((span) => span.text).join(""));
  const starts = rows.map((row) => row.indexOf("second column"));
  expect(starts.every((start) => start > 0)).toBe(true);
  expect(new Set(starts).size).toBe(1);
});

test("help keys read plain and their descriptions dim", () => {
  const scene = layoutComposerStatus({
    presentation: { ...base, showHelp: true, helpEntries: [{ key: "ctrl + w", description: "to delete a word" }] },
    constraints: { columns: 120, rows: 40 },
  });
  const row = scene.lines.at(-1);
  expect(row?.spans.find((span) => span.role === "plain" && span.text.includes("ctrl"))?.text.trim()).toBe("ctrl + w");
  expect(row?.spans.find((span) => span.role === "muted")?.text.trim()).toBe("to delete a word");
});
