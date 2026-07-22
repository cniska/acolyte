import { expect, test } from "bun:test";
import { SHORTCUT_ITEMS } from "./chat-layout";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { layoutChatViewport, layoutFooterStatus } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { terminalTheme } from "./terminal-theme";
import { createSession, dedent } from "./test-utils";
import { renderPlain } from "./tui/test-utils";

const footer = {
  repo: "acolyte",
  worktree: null,
  branch: "main",
  dirty: true,
  ahead: 2,
  behind: 1,
  model: "gpt-5",
  effort: "medium",
  inputTokens: 48600,
  outputTokens: 12400,
  pr: null,
  skills: [],
} as const;

const footerGolden = "  acolyte · main* ↑2 ↓1 · gpt-5 medium · ↑48.6k ↓12.4k";

test("semantic footer scene renders the status line", () => {
  const scene = renderPlain(<TerminalSceneRender scene={layoutFooterStatus(footer, 80)} />, 80);
  expect(scene).toBe(footerGolden);
});

test("viewport adapter carries the semantic footer into the full scene", () => {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: null,
      suggestions: { kind: "none" },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  });
  const scene = layoutChatViewport({
    presentation,
    constraints: { columns: 80, rows: 40 },
    theme: terminalTheme,
    now: 0,
  });
  expect(
    scene.lines
      .at(-1)
      ?.spans.map((span) => span.text)
      .join(""),
  ).toBe(footerGolden);
});

test("ctrl-c composer scene renders the exit hint", () => {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: null,
      suggestions: { kind: "none" },
      help: { visible: false, entries: [] },
      ctrlCPending: true,
      footer,
    },
  });
  const scene = layoutChatViewport({
    presentation,
    constraints: { columns: 80, rows: 40 },
    theme: terminalTheme,
    now: 0,
  });
  const composer = scene.sections?.find((item) => item.id === "composer");
  expect(composer).toBeDefined();
  const lines = scene.lines.slice(composer?.lineStart, composer?.lineEnd);
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(
    dedent(`
      ────────────────────────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────────────────────────
        ctrl+c again to exit
    `),
  );
});

test("model-picker loading scene renders the picker chrome", () => {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: {
        kind: "model",
        input: { text: "gpt", cursor: 3 },
        items: [],
        selected: 0,
        scrollOffset: 0,
        loading: true,
      },
      suggestions: { kind: "none" },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  });
  const scene = layoutChatViewport({
    presentation,
    constraints: { columns: 80, rows: 40 },
    theme: terminalTheme,
    now: 0,
  });
  const composer = scene.sections?.find((item) => item.id === "composer");
  expect(composer).toBeDefined();
  const lines = scene.lines.slice(composer?.lineStart, composer?.lineEnd);
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(
    dedent(`
      ────────────────────────────────────────────────────────────────────────────────
      Model: gpt

        Loading…

      Type to filter · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────
    `),
  );
});

test("resume-picker scene renders the session list", () => {
  const session = createSession({
    id: "sess_previous",
    title: "Previous session",
    updatedAt: "2026-07-21T00:00:00.000Z",
  });
  const originalNow = Date.now;
  Date.now = () => new Date("2026-07-22T00:00:00.000Z").getTime();
  try {
    const presentation = createChatViewportPresentation({
      header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
      activeTranscript: [],
      pending: null,
      composer: {
        input: { text: "", cursor: 0 },
        picker: {
          kind: "sessions",
          items: [{ id: session.id, title: session.title, updatedAt: session.updatedAt }],
          selected: 0,
          scrollOffset: 0,
          activeSessionId: session.id,
        },
        suggestions: { kind: "none" },
        help: { visible: false, entries: [] },
        ctrlCPending: false,
        footer,
      },
    });
    const scene = layoutChatViewport({
      presentation,
      constraints: { columns: 80, rows: 40 },
      theme: terminalTheme,
      now: Date.now(),
    });
    const composer = scene.sections?.find((item) => item.id === "composer");
    expect(composer).toBeDefined();
    const lines = scene.lines.slice(composer?.lineStart, composer?.lineEnd);
    expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(
      dedent(`
        ────────────────────────────────────────────────────────────────────────────────
        Resume Session

        › ● sess_previous  Previous session  1d ago

        Enter to resume · Esc to close
        ────────────────────────────────────────────────────────────────────────────────
      `),
    );
  } finally {
    Date.now = originalNow;
  }
});

test("skills-picker scene renders the skill list", () => {
  const items = [
    { name: "build", description: "Implement a vertical slice", path: "/skills/build", source: "project" as const },
  ];
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: { kind: "skills", items, selected: 0 },
      suggestions: { kind: "none" },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  });
  const scene = layoutChatViewport({
    presentation,
    constraints: { columns: 80, rows: 40 },
    theme: terminalTheme,
    now: 0,
  });
  const composer = scene.sections?.find((item) => item.id === "composer");
  expect(composer).toBeDefined();
  const lines = scene.lines.slice(composer?.lineStart, composer?.lineEnd);
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(
    dedent(`
      ────────────────────────────────────────────────────────────────────────────────
      Skills

      › build                Implement a vertical slice

      Enter to select · Esc to close
      ────────────────────────────────────────────────────────────────────────────────
    `),
  );
});

test("model-picker scene renders the filtered options", () => {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: {
        kind: "model",
        input: { text: "", cursor: 0 },
        items: [
          { label: "GPT-5", value: "openai/gpt-5" },
          { label: "Claude", value: "anthropic/claude" },
        ],
        selected: 1,
        scrollOffset: 0,
        loading: false,
      },
      suggestions: { kind: "none" },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  });
  const scene = layoutChatViewport({
    presentation,
    constraints: { columns: 80, rows: 40 },
    theme: terminalTheme,
    now: 0,
  });
  const composer = scene.sections?.find((item) => item.id === "composer");
  expect(composer).toBeDefined();
  const lines = scene.lines.slice(composer?.lineStart, composer?.lineEnd);
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(
    dedent(`
      ────────────────────────────────────────────────────────────────────────────────
      Model:

        GPT-5
      › Claude

      Type to filter · Enter to apply · Esc to close
      ────────────────────────────────────────────────────────────────────────────────
    `),
  );
});

test("at-suggestion scene renders the path candidates", () => {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "@src", cursor: 4 },
      picker: null,
      suggestions: { kind: "at", query: "src", candidates: ["src/chat-state.ts", "src/chat-app.tsx"], selected: 1 },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  });
  const scene = layoutChatViewport({
    presentation,
    constraints: { columns: 80, rows: 40 },
    theme: terminalTheme,
    now: 0,
  });
  const composer = scene.sections?.find((item) => item.id === "composer");
  expect(composer).toBeDefined();
  const lines = scene.lines.slice(composer?.lineStart, composer?.lineEnd);
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(
    dedent(`
      ────────────────────────────────────────────────────────────────────────────────
      ❯ @src
      ────────────────────────────────────────────────────────────────────────────────
        src/chat-state.ts
        src/chat-app.tsx
    `),
  );
});

test("slash-suggestion scene renders the command candidates", () => {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "/st", cursor: 3 },
      picker: null,
      suggestions: { kind: "slash", candidates: ["/status", "/stop"], selected: 0 },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  });
  const scene = layoutChatViewport({
    presentation,
    constraints: { columns: 80, rows: 40 },
    theme: terminalTheme,
    now: 0,
  });
  const composer = scene.sections?.find((item) => item.id === "composer");
  expect(composer).toBeDefined();
  const lines = scene.lines.slice(composer?.lineStart, composer?.lineEnd);
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(
    dedent(`
      ────────────────────────────────────────────────────────────────────────────────
      ❯ /st
      ────────────────────────────────────────────────────────────────────────────────
        /status
        /stop

        show server status
    `),
  );
});

test("help-pane scene renders the shortcut grid at the two-column breakpoint", () => {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: null,
      suggestions: { kind: "none" },
      help: { visible: true, entries: SHORTCUT_ITEMS },
      ctrlCPending: false,
      footer,
    },
  });
  const scene = layoutChatViewport({
    presentation,
    constraints: { columns: 96, rows: 40 },
    theme: terminalTheme,
    now: 0,
  });
  const composer = scene.sections?.find((item) => item.id === "composer");
  expect(composer).toBeDefined();
  const lines = scene.lines.slice(composer?.lineStart, composer?.lineEnd);
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 96)).toBe(
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
