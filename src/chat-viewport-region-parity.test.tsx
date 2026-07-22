import { expect, test } from "bun:test";
import { ChatChecklist } from "./chat-checklist";
import type { ChatRow } from "./chat-contract";
import { ChatInputPanel } from "./chat-input-panel";
import { ChatTranscript } from "./chat-transcript";
import type { TranscriptRow } from "./chat-transcript-contract";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import type { ChecklistOutput } from "./checklist-contract";
import { layoutChatViewport } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { terminalTheme } from "./terminal-theme";
import { Box, Text } from "./tui";
import { renderPlain } from "./tui/test-utils";

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

const columns = 60;

const checklist: ChecklistOutput = {
  groupId: "g1",
  groupTitle: "Plan",
  items: [
    { id: "i1", label: "step one", status: "done", order: 0 },
    { id: "i2", label: "step two", status: "in_progress", order: 1 },
  ],
};

// Mirror of chat-app.tsx's live region: everything rendered below the <Static>
// promoted scrollback. The scene tail (the lines after the promoted `header`
// section) must render byte-for-byte the same as this composition.
function LegacyLiveRegion(props: {
  rows: ChatRow[];
  presentation: TranscriptRow[];
  checklistRows: ChatRow[];
  pendingState?: Parameters<typeof ChatTranscript>[0]["pendingState"];
  queued?: string[];
}) {
  return (
    <Box flexDirection="column">
      <ChatTranscript
        rows={props.rows}
        presentation={props.presentation}
        pendingState={props.pendingState ?? null}
        pendingFrame={0}
        pendingStartedAt={0}
        queuedMessages={props.queued ?? []}
        runningUsage={null}
      />
      <ChatChecklist rows={props.checklistRows} presentation={props.presentation} />
      <Text> </Text>
      <ChatInputPanel statusLine={footer} value="" onCursorLine={() => {}} />
    </Box>
  );
}

function sceneTail(input: {
  activeTranscript: TranscriptRow[];
  pending?: ReturnType<typeof createChatViewportPresentation>["pending"];
}): string {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: input.activeTranscript,
    pending: input.pending ?? null,
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
    constraints: { columns, rows: 60 },
    theme: terminalTheme,
    now: 5000,
  });
  const header = scene.sections?.find((section) => section.id === "header");
  return renderPlain(<TerminalSceneRender scene={{ lines: scene.lines.slice(header?.lineEnd) }} />, columns);
}

test("empty session live region matches the legacy composer", () => {
  const legacy = renderPlain(<LegacyLiveRegion rows={[]} presentation={[]} checklistRows={[]} />, columns);
  expect(sceneTail({ activeTranscript: [] })).toBe(legacy);
});

test("transcript rows live region matches legacy spacing", () => {
  const rows: ChatRow[] = [
    { id: "r1", kind: "user", content: "hello there" },
    { id: "r2", kind: "assistant", content: "hi back" },
  ];
  const presentation: TranscriptRow[] = [
    { id: "r1", kind: "user", status: "complete", content: { kind: "message", text: "hello there" } },
    { id: "r2", kind: "assistant", status: "complete", content: { kind: "message", text: "hi back" } },
  ];
  const legacy = renderPlain(<LegacyLiveRegion rows={rows} presentation={presentation} checklistRows={[]} />, columns);
  expect(sceneTail({ activeTranscript: presentation })).toBe(legacy);
});

test("rows, pending, and checklist live region matches legacy order and indent", () => {
  const originalNow = Date.now;
  Date.now = () => 5000;
  try {
    const rows: ChatRow[] = [
      { id: "r1", kind: "user", content: "do the thing" },
      { id: "r2", kind: "assistant", content: "on it" },
    ];
    const checklistRow: ChatRow = { id: "cl", kind: "tool", content: checklist as unknown as ChatRow["content"] };
    const presentation: TranscriptRow[] = [
      { id: "r1", kind: "user", status: "complete", content: { kind: "message", text: "do the thing" } },
      { id: "r2", kind: "assistant", status: "complete", content: { kind: "message", text: "on it" } },
      { id: "cl", kind: "tool", status: "active", content: { kind: "checklist", output: checklist } },
    ];
    const legacy = renderPlain(
      <LegacyLiveRegion
        rows={rows}
        presentation={presentation}
        checklistRows={[checklistRow]}
        pendingState={{ kind: "running", toolCalls: 1 }}
      />,
      columns,
    );
    const scene = sceneTail({
      activeTranscript: presentation,
      pending: {
        state: { kind: "running", toolCalls: 1 },
        frame: 0,
        startedAt: 0,
        queuedMessages: [],
        runningUsage: null,
      },
    });
    expect(scene).toBe(legacy);
  } finally {
    Date.now = originalNow;
  }
});

test("queued messages live region matches legacy", () => {
  const originalNow = Date.now;
  Date.now = () => 5000;
  try {
    const rows: ChatRow[] = [{ id: "r1", kind: "user", content: "first" }];
    const presentation: TranscriptRow[] = [
      { id: "r1", kind: "user", status: "complete", content: { kind: "message", text: "first" } },
    ];
    const legacy = renderPlain(
      <LegacyLiveRegion
        rows={rows}
        presentation={presentation}
        checklistRows={[]}
        pendingState={{ kind: "running", toolCalls: 0 }}
        queued={["next up"]}
      />,
      columns,
    );
    const scene = sceneTail({
      activeTranscript: presentation,
      pending: {
        state: { kind: "running", toolCalls: 0 },
        frame: 0,
        startedAt: 0,
        queuedMessages: ["next up"],
        runningUsage: null,
      },
    });
    expect(scene).toBe(legacy);
  } finally {
    Date.now = originalNow;
  }
});
