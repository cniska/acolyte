import { describe, expect, test } from "bun:test";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { layoutChatViewport } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { terminalTheme } from "./terminal-theme";
import { dedent } from "./test-utils";
import { DEFAULT_TERMINAL_WIDTH } from "./tui/constants";
import { renderToString } from "./tui/render-to-string";
import { stripAnsiLength } from "./tui/serialize";
import { renderPlain, withTerminalWidth } from "./tui/test-utils";

type PickerInput = NonNullable<Parameters<typeof createChatViewportPresentation>[0]["composer"]["picker"]>;

const footer = {
  repo: "acolyte",
  worktree: null,
  branch: "main",
  dirty: false,
  ahead: 0,
  behind: 0,
  model: "gpt-5",
  effort: null,
  inputTokens: 0,
  outputTokens: 0,
  pr: null,
  skills: [],
} as const;

function pickerScene(picker: PickerInput, columns: number) {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker,
      suggestions: { kind: "none" },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  });
  const scene = layoutChatViewport({ presentation, constraints: { columns, rows: 40 }, theme: terminalTheme, now: 0 });
  const composer = scene.sections?.find((section) => section.id === "composer");
  return { lines: scene.lines.slice(composer?.lineStart, composer?.lineEnd) };
}

function renderInputPanelWithPicker(picker: PickerInput, columns = DEFAULT_TERMINAL_WIDTH): string {
  return renderPlain(<TerminalSceneRender scene={pickerScene(picker, columns)} />, columns);
}

function pickerRowWidths(picker: PickerInput, columns: number): number[] {
  const raw = withTerminalWidth(columns, () =>
    renderToString(<TerminalSceneRender scene={pickerScene(picker, columns)} />),
  );
  return raw.split("\n").map((line) => stripAnsiLength(line));
}

describe("chat picker visual regression", () => {
  test("renders skills picker", () => {
    const out = renderInputPanelWithPicker({
      kind: "skills",
      items: [
        {
          name: "build",
          description: "Implement features incrementally through vertical slices",
          path: "bundled://build",
          source: "bundled" as const,
        },
        {
          name: "debug",
          description: "Debug systematically with structured triage",
          path: "bundled://debug",
          source: "bundled" as const,
        },
      ],
      selected: 0,
    });
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Skills

      › build                Implement features incrementally through vertical slices
        debug                Debug systematically with structured triage

      Enter to select · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });

  test("clips skill label and description to terminal width", () => {
    const out = renderInputPanelWithPicker(
      {
        kind: "skills",
        items: [
          {
            name: "improve-codebase-architecture",
            description: "Find deepening opportunities in a codebase, informed by domain language and ADRs",
            path: "bundled://improve",
            source: "bundled" as const,
          },
          {
            name: "build",
            description: "Implement features incrementally through vertical slices",
            path: "bundled://build",
            source: "bundled" as const,
          },
        ],
        selected: 0,
      },
      40,
    );
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────
      Skills

      › improve-codebase-ar… Find deepening o…
        build                Implement featur…

      Enter to select · Esc to close
      ────────────────────────────────────────
    `),
    );
  });

  test("clips resume title but keeps the timestamp at narrow width", () => {
    const realNow = Date.now;
    Date.now = () => new Date("2026-03-02T00:00:00.000Z").getTime();
    try {
      const out = renderInputPanelWithPicker(
        {
          kind: "sessions",
          items: [
            {
              id: "sess_active",
              title: "A very long session title that needs clipping at narrow widths for sure",
              updatedAt: "2026-03-02T00:00:00.000Z",
            },
            { id: "sess_prev", title: "Short", updatedAt: "2026-03-02T00:00:00.000Z" },
          ],
          selected: 1,
          scrollOffset: 0,
          activeSessionId: "sess_active",
        },
        40,
      );
      expect(out).toBe(
        dedent(`
        ────────────────────────────────────────
        Resume Session

          ● sess_active  A very long …  just now
        ›   sess_prev    Short          just now

        Enter to resume · Esc to close
        ────────────────────────────────────────
      `),
      );
    } finally {
      Date.now = realNow;
    }
  });

  test("renders resume picker", () => {
    const realNow = Date.now;
    Date.now = () => new Date("2026-03-02T00:00:00.000Z").getTime();
    try {
      const out = renderInputPanelWithPicker({
        kind: "sessions",
        items: [
          { id: "sess_active", title: "Current Session", updatedAt: "2026-03-02T00:00:00.000Z" },
          { id: "sess_prev", title: "Previous Session", updatedAt: "2026-03-02T00:00:00.000Z" },
        ],
        selected: 1,
        scrollOffset: 0,
        activeSessionId: "sess_active",
      });

      expect(out).toBe(
        dedent(`
        ────────────────────────────────────────────────────────────────────────────────────────────────
        Resume Session

          ● sess_active  Current Session   just now
        ›   sess_prev    Previous Session  just now

        Enter to resume · Esc to close
        ────────────────────────────────────────────────────────────────────────────────────────────────
      `),
      );
    } finally {
      Date.now = realNow;
    }
  });

  test("renders every skill and keeps the selection visible past the page size", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      name: `skill-${String(i + 1).padStart(2, "0")}`,
      description: "desc",
      path: `bundled://skill-${i + 1}`,
      source: "bundled" as const,
    }));
    const out = renderInputPanelWithPicker({ kind: "skills", items, selected: 9 }, 80);
    expect(out).toContain("skill-01");
    expect(out).toContain("skill-10");
    expect(out).toContain("› skill-10");
  });

  test("clips overflowing picker rows to exactly the terminal width", () => {
    const widths = pickerRowWidths(
      {
        kind: "skills",
        items: [
          {
            name: "improve-codebase-architecture",
            description: "Find deepening opportunities in a codebase, informed by domain language and ADRs",
            path: "bundled://improve",
            source: "bundled" as const,
          },
        ],
        selected: 0,
      },
      40,
    );
    for (const width of widths) {
      expect(width).toBeLessThanOrEqual(40);
    }
    // The overflowing skill row is clipped up to the full terminal width, not left short.
    expect(Math.max(...widths)).toBe(40);
  });
});
