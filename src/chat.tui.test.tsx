import { describe, expect, test } from "bun:test";
import { SHORTCUT_ITEMS } from "./chat-layout";
import type { ViewportPickerInput, ViewportSuggestionsInput } from "./chat-viewport-contract";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { layoutChatViewport, layoutHeader } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { terminalTheme } from "./terminal-theme";
import { dedent } from "./test-utils";
import { DEFAULT_TERMINAL_WIDTH } from "./tui/constants";
import { renderPlain } from "./tui/test-utils";

const DEFAULT_STATUS_LINE = {
  repo: "acolyte",
  worktree: null,
  branch: "main",
  dirty: false,
  ahead: 0,
  behind: 0,
  model: "gpt-5-mini",
  effort: "medium",
  inputTokens: 0,
  outputTokens: 0,
  pr: null,
  skills: [],
} as const;

type LegacyModelPicker = {
  kind: "model";
  items: Array<{ label: string; value: string }>;
  filtered: Array<{ label: string; value: string }>;
  input: { text: string; cursor: number };
  index: number;
  scrollOffset: number;
  loading?: boolean;
};

type InputPanelOverrides = {
  statusLine?: typeof DEFAULT_STATUS_LINE;
  showHelp?: boolean;
  value?: string;
  slashSuggestions?: string[];
  slashSuggestionIndex?: number;
  atSuggestions?: { query: string; candidates: string[]; selected: number };
  ctrlCPending?: boolean;
  picker?: LegacyModelPicker;
};

function composerScene(overrides: InputPanelOverrides, columns: number) {
  const value = overrides.value ?? "";

  const suggestions: ViewportSuggestionsInput = overrides.slashSuggestions
    ? {
        kind: "slash",
        candidates: overrides.slashSuggestions,
        selected: overrides.slashSuggestionIndex ?? 0,
      }
    : overrides.atSuggestions
      ? {
          kind: "at",
          query: overrides.atSuggestions.query,
          candidates: overrides.atSuggestions.candidates,
          selected: overrides.atSuggestions.selected,
        }
      : { kind: "none" };

  const picker: ViewportPickerInput | null = overrides.picker
    ? {
        kind: "model",
        input: overrides.picker.input,
        items: overrides.picker.filtered,
        selected: overrides.picker.index,
        scrollOffset: overrides.picker.scrollOffset,
        loading: overrides.picker.loading ?? false,
      }
    : null;

  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: value, cursor: value.length },
      picker,
      suggestions,
      help: overrides.showHelp ? { visible: true, entries: SHORTCUT_ITEMS } : { visible: false, entries: [] },
      ctrlCPending: overrides.ctrlCPending ?? false,
      footer: overrides.statusLine ?? DEFAULT_STATUS_LINE,
    },
  });
  const scene = layoutChatViewport({ presentation, constraints: { columns, rows: 40 }, theme: terminalTheme, now: 0 });
  const composer = scene.sections?.find((section) => section.id === "composer");
  return { lines: scene.lines.slice(composer?.lineStart, composer?.lineEnd) };
}

function renderInputPanel(overrides: InputPanelOverrides = {}, columns = DEFAULT_TERMINAL_WIDTH): string {
  return renderPlain(<TerminalSceneRender scene={composerScene(overrides, columns)} />, columns);
}

describe("chat tui visual regression: header", () => {
  test("renders stable header block", () => {
    const out = renderPlain(
      <TerminalSceneRender scene={layoutHeader({ title: "Acolyte", version: "0.1.0", sessionId: "sess_demo1234" })} />,
    );
    expect(out).toBe(
      dedent(
        `
     ▗█████▖   Acolyte
    ▟█ ● ● █▙  version 0.1.0
    ▜█▄▄▄▄▄█▛  session sess_demo1234
    `,
        2,
      ),
    );
  });
});

describe("chat tui visual regression: status line and help", () => {
  test("renders stable, left-aligned status line row", () => {
    const out = renderInputPanel();
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────────────────────────────────────────
        acolyte · main · gpt-5-mini medium
    `),
    );
  });

  test("renders help pane without context", () => {
    const out = renderInputPanel({ showHelp: true });
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────────────────────────────────────────
        @path               attach file             /status             show server status
        /new                start new session       /memory [scope]     show memory notes
        /resume <id>        resume session          /memory add <text>  add memory note
        /sessions           show sessions           /usage              show token usage
        /workspaces         manage workspaces       /skills             show skills picker
        /model              change model            /exit               exit chat
    `),
    );
  });

  test("renders single-column help pane at narrow width without context", () => {
    const out = renderInputPanel({ showHelp: true }, 80);
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────────────────────────
        @path               attach file
        /new                start new session
        /resume <id>        resume session
        /sessions           show sessions
        /workspaces         manage workspaces
        /model              change model
        /status             show server status
        /memory [scope]     show memory notes
        /memory add <text>  add memory note
        /usage              show token usage
        /skills             show skills picker
        /exit               exit chat
    `),
    );
  });

  test("renders slash suggestions with selected help and no status line row", () => {
    const out = renderInputPanel({
      value: "/mo",
      slashSuggestions: ["/model"],
      slashSuggestionIndex: 0,
    });
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      ❯ /mo
      ────────────────────────────────────────────────────────────────────────────────────────────────
        /model

        change model
    `),
    );
  });

  test("renders the ctrl-c exit hint below the composer", () => {
    const out = renderInputPanel({ ctrlCPending: true }, 80);
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────────────────────────
        ctrl+c again to exit
    `),
    );
  });

  test("renders at-mention suggestions below the composer", () => {
    const out = renderInputPanel(
      {
        value: "@src",
        atSuggestions: { query: "src", candidates: ["src/chat-state.ts", "src/chat-app.tsx"], selected: 1 },
      },
      80,
    );
    expect(out).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────
      ❯ @src
      ────────────────────────────────────────────────────────────────────────────────
        src/chat-state.ts
        src/chat-app.tsx
    `),
    );
  });
});

describe("chat tui visual regression: model picker", () => {
  test("renders model picker with selected model", () => {
    const picker = {
      kind: "model" as const,
      items: [
        { label: "gpt-5-mini", value: "gpt-5-mini" },
        { label: "gpt-5.2", value: "gpt-5.2" },
      ],
      filtered: [
        { label: "gpt-5-mini", value: "gpt-5-mini" },
        { label: "gpt-5.2", value: "gpt-5.2" },
      ],
      input: { text: "", cursor: 0 },
      index: 1,
      scrollOffset: 0,
    };

    const output = renderInputPanel({ picker });
    expect(output).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Model:

        gpt-5-mini
      › gpt-5.2

      Type to filter · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });

  test("renders local model picker with full model id", () => {
    const picker = {
      kind: "model" as const,
      items: [{ label: "openai-compatible/qwen2.5-coder:3b", value: "openai-compatible/qwen2.5-coder:3b" }],
      filtered: [{ label: "openai-compatible/qwen2.5-coder:3b", value: "openai-compatible/qwen2.5-coder:3b" }],
      input: { text: "", cursor: 0 },
      index: 0,
      scrollOffset: 0,
    };

    const output = renderInputPanel({ picker });
    expect(output).toContain("openai-compatible/qwen2.5-coder:3b");
  });

  test("renders model picker with query filter", () => {
    const picker = {
      kind: "model" as const,
      items: [
        { label: "gpt-5-mini", value: "gpt-5-mini" },
        { label: "gpt-5.2", value: "gpt-5.2" },
      ],
      filtered: [{ label: "gpt-5.2", value: "gpt-5.2" }],
      input: { text: "5.2", cursor: 3 },
      index: 0,
      scrollOffset: 0,
    };

    const output = renderInputPanel({ picker });
    expect(output).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Model: 5.2

      › gpt-5.2

      Type to filter · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });

  test("renders model picker empty state when no matches", () => {
    const picker = {
      kind: "model" as const,
      items: [
        { label: "gpt-5-mini", value: "gpt-5-mini" },
        { label: "gpt-5.2", value: "gpt-5.2" },
      ],
      filtered: [],
      input: { text: "zzz", cursor: 3 },
      index: 0,
      scrollOffset: 0,
    };

    const output = renderInputPanel({ picker });
    expect(output).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Model: zzz

       No matches.

      Type to filter · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });

  test("renders model picker with scroll window", () => {
    const models = Array.from({ length: 12 }, (_, i) => {
      const label = `model-${String(i + 1).padStart(2, "0")}`;
      return { label, value: label };
    });
    const picker = {
      kind: "model" as const,
      items: models,
      filtered: models,
      input: { text: "", cursor: 0 },
      index: 9,
      scrollOffset: 4,
    };

    const output = renderInputPanel({ picker });
    expect(output).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────────────────────
      Model:

        model-05
        model-06
        model-07
        model-08
        model-09
      › model-10
        model-11
        model-12

      Type to filter · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });

  test("renders the loading state while models resolve", () => {
    const picker = {
      kind: "model" as const,
      items: [],
      filtered: [],
      input: { text: "gpt", cursor: 3 },
      index: 0,
      scrollOffset: 0,
      loading: true,
    };

    const output = renderInputPanel({ picker }, 80);
    expect(output).toBe(
      dedent(`
      ────────────────────────────────────────────────────────────────────────────────
      Model: gpt

        Loading…

      Type to filter · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────
    `),
    );
  });
});
