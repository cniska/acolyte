import { expect, test } from "bun:test";
import { ChatHeader } from "./chat-header";
import { ChatInputPanel } from "./chat-input-panel";
import { SHORTCUT_ITEMS } from "./chat-layout";
import { StatusLine } from "./chat-status-line";
import { ChatTranscript, ChatTranscriptRow } from "./chat-transcript";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { palette } from "./palette";
import { layoutChatViewport, layoutFooterStatus, layoutHeader, layoutPending } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { terminalTheme } from "./terminal-theme";
import { createSession } from "./test-utils";
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

test("header scene matches the legacy header", () => {
  const header = { title: "Acolyte", version: "1", sessionId: "sess_1" };
  const legacy = renderPlain(
    <ChatHeader
      lines={[
        { id: "title", text: header.title },
        { id: "session", text: `version ${header.version}` },
        { id: "context", text: `session ${header.sessionId}` },
      ]}
      brandColor={palette.brand}
      mascot={palette.mascot}
      mascotEyes={palette.mascotEyes}
    />,
    80,
  );
  const scene = renderPlain(<TerminalSceneRender scene={layoutHeader(header)} />, 80);
  expect(scene).toBe(legacy);
});

test("semantic footer scene matches the legacy footer without skills", () => {
  const legacy = renderPlain(<StatusLine {...footer} />, 80);
  const scene = renderPlain(<TerminalSceneRender scene={layoutFooterStatus(footer, 80)} />, 80);
  expect(scene).toBe(legacy);
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
  ).toBe(renderPlain(<StatusLine {...footer} />, 80));
});

test("user transcript scene matches the legacy transcript row", () => {
  const row = { id: "row_user", kind: "user" as const, content: "Inspect the current changes" };
  const legacy = renderPlain(<ChatTranscriptRow row={row} contentWidth={38} toolContentWidth={38} />, 40);
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [
      { id: row.id, kind: row.kind, status: "complete", content: { kind: "message", text: row.content } },
    ],
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
    constraints: { columns: 40, rows: 40 },
    theme: terminalTheme,
    now: 0,
  });
  const section = scene.sections?.find((item) => item.id === row.id);
  expect(section).toBeDefined();
  const lines = scene.lines.slice(section?.lineStart, section?.lineEnd);
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 40)).toBe(legacy);
});

test("ctrl-c composer scene replaces the legacy footer with its hint", () => {
  const legacy = renderPlain(<ChatInputPanel statusLine={footer} ctrlCPending onCursorLine={() => {}} />, 80);
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
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(legacy);
});

test("model-picker loading scene matches the legacy picker", () => {
  const picker = {
    kind: "model" as const,
    items: [],
    filtered: [],
    input: { text: "gpt", cursor: 3 },
    index: 0,
    scrollOffset: 0,
    loading: true,
  };
  const legacy = renderPlain(<ChatInputPanel picker={picker} onCursorLine={() => {}} />, 80);
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: {
        kind: "model",
        input: picker.input,
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
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(legacy);
});

test("resume-picker scene matches the legacy picker", () => {
  const session = createSession({
    id: "sess_previous",
    title: "Previous session",
    updatedAt: "2026-07-21T00:00:00.000Z",
  });
  const picker = { kind: "resume" as const, items: [session], index: 0, scrollOffset: 0 };
  const legacy = renderPlain(
    <ChatInputPanel picker={picker} activeSessionId={session.id} onCursorLine={() => {}} />,
    80,
  );
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
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(legacy);
});

test("skills-picker scene matches the legacy picker", () => {
  const legacyPicker = {
    kind: "skills" as const,
    items: [
      { name: "build", description: "Implement a vertical slice", path: "/skills/build", source: "project" as const },
    ],
    index: 0,
  };
  const legacy = renderPlain(<ChatInputPanel picker={legacyPicker} onCursorLine={() => {}} />, 80);
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: { kind: "skills", items: legacyPicker.items, selected: 0 },
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
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(legacy);
});

test("model-picker scene matches the legacy picker", () => {
  const legacyPicker = {
    kind: "model" as const,
    items: [],
    filtered: [
      { label: "GPT-5", value: "openai/gpt-5" },
      { label: "Claude", value: "anthropic/claude" },
    ],
    input: { text: "", cursor: 0 },
    index: 1,
    scrollOffset: 0,
  };
  const legacy = renderPlain(<ChatInputPanel picker={legacyPicker} onCursorLine={() => {}} />, 80);
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: {
        kind: "model",
        input: legacyPicker.input,
        items: legacyPicker.filtered,
        selected: legacyPicker.index,
        scrollOffset: legacyPicker.scrollOffset,
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
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(legacy);
});

test("at-suggestion scene matches the legacy composer", () => {
  const legacy = renderPlain(
    <ChatInputPanel
      value="@src"
      atQuery="src"
      atSuggestions={["src/chat-state.ts", "src/chat-app.tsx"]}
      atSuggestionIndex={1}
      onCursorLine={() => {}}
    />,
    80,
  );
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
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(legacy);
});

test("slash-suggestion scene matches the legacy composer", () => {
  const legacy = renderPlain(
    <ChatInputPanel
      value="/st"
      slashSuggestions={["/status", "/stop"]}
      slashSuggestionIndex={0}
      onCursorLine={() => {}}
    />,
    80,
  );
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
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 80)).toBe(legacy);
});

test("help-pane scene matches the legacy composer at the two-column breakpoint", () => {
  const helpEntries = SHORTCUT_ITEMS;
  const legacy = renderPlain(<ChatInputPanel showHelp onCursorLine={() => {}} />, 96);
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [],
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: null,
      suggestions: { kind: "none" },
      help: { visible: true, entries: helpEntries },
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
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 96)).toBe(legacy);
});

test("running pending scene matches the legacy pending row", () => {
  const now = 6_000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const legacy = renderPlain(
      <ChatTranscript
        rows={[]}
        pendingState={{ kind: "running", toolCalls: 2 }}
        pendingFrame={0}
        pendingStartedAt={1_000}
        runningUsage={{ inputTokens: 1200, outputTokens: 34 }}
        queuedMessages={["after this"]}
      />,
      40,
    );
    const scene = renderPlain(
      <TerminalSceneRender
        scene={layoutPending({
          presentation: {
            state: { kind: "running", toolCalls: 2 },
            frame: 0,
            startedAt: 1_000,
            runningUsage: { inputTokens: 1200, outputTokens: 34 },
            queuedMessages: ["after this"],
          },
          now,
          columns: 40,
        })}
      />,
      40,
    );
    expect(scene).toBe(legacy);
  } finally {
    Date.now = originalNow;
  }
});

test("outcome transcript scenes match legacy status and task rows", () => {
  const cases = [
    {
      row: { id: "row_status", kind: "status" as const, content: "Worked", style: { outcome: "success" as const } },
      status: "success" as const,
    },
    {
      row: { id: "row_task", kind: "task" as const, content: "Failed", style: { outcome: "error" as const } },
      status: "error" as const,
    },
  ];
  for (const { row, status } of cases) {
    const legacy = renderPlain(<ChatTranscriptRow row={row} contentWidth={38} toolContentWidth={38} />, 40);
    const presentation = createChatViewportPresentation({
      header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
      activeTranscript: [{ id: row.id, kind: row.kind, status, content: { kind: "message", text: row.content } }],
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
      constraints: { columns: 40, rows: 40 },
      theme: terminalTheme,
      now: 0,
    });
    const section = scene.sections?.find((item) => item.id === row.id);
    expect(section).toBeDefined();
    const lines = scene.lines.slice(section?.lineStart, section?.lineEnd);
    expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 40)).toBe(legacy);
  }
});

test("tool-output scene matches the legacy transcript row", () => {
  const parts = [
    { kind: "tool-header" as const, labelKey: "tool.label.file_edit", detail: "src/a.ts" },
    { kind: "diff" as const, marker: "remove" as const, lineNumber: 1, text: "before" },
    { kind: "diff" as const, marker: "add" as const, lineNumber: 1, text: "after" },
    { kind: "truncated" as const, count: 4, unit: "lines" },
  ];
  const row = { id: "row_tool", kind: "tool" as const, content: { parts } };
  const legacy = renderPlain(<ChatTranscriptRow row={row} contentWidth={38} toolContentWidth={38} />, 40);
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [
      { id: row.id, kind: row.kind, status: "complete", content: { kind: "tool-output", output: row.content } },
    ],
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
    constraints: { columns: 40, rows: 40 },
    theme: terminalTheme,
    now: 0,
  });
  const section = scene.sections?.find((item) => item.id === row.id);
  expect(section).toBeDefined();
  const lines = scene.lines.slice(section?.lineStart, section?.lineEnd);
  expect(renderPlain(<TerminalSceneRender scene={{ lines }} />, 40)).toBe(legacy);
});
