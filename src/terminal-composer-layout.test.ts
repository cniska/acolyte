import { expect, test } from "bun:test";
import { layoutComposerStatus } from "./terminal-chat-layout";

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
  status: [{ kind: "model" as const, text: " model", role: "muted" as const }],
};

test("composer layout preserves border, continuation prompt, and footer", () => {
  const scene = layoutComposerStatus({ presentation: base, constraints: { columns: 12, rows: 20 } });
  expect(scene.lines[0]?.spans[0]?.text).toBe("─".repeat(24));
  expect(scene.lines[2]?.spans[0]?.text).toBe("  ");
  expect(scene.lines.at(-1)?.spans[0]?.text).toBe(" model");
  expect(scene.cursor?.row).toBeGreaterThan(0);
});

test("composer layout windows picker items", () => {
  const scene = layoutComposerStatus({
    presentation: {
      ...base,
      picker: {
        kind: "model",
        query: "x",
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
  expect(scene.lines.map((line) => line.spans.map((span) => span.text).join(""))).toContain("› two");
});
