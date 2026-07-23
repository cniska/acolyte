import { expect, test } from "bun:test";
import type { TranscriptRow } from "./chat-transcript-contract";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import type { TasklistOutput } from "./tasklist-contract";
import { layoutChatViewport } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { terminalTheme } from "./terminal-theme";
import { dedent } from "./test-utils";
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

const tasklist: TasklistOutput = {
  groupId: "g1",
  groupTitle: "Plan",
  items: [
    { id: "i1", label: "step one", status: "done", order: 0 },
    { id: "i2", label: "step two", status: "in_progress", order: 1 },
  ],
};

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

test("transcript rows live region renders messages above the composer", () => {
  const presentation: TranscriptRow[] = [
    { id: "r1", kind: "user", status: "complete", content: { kind: "message", text: "hello there" } },
    { id: "r2", kind: "assistant", status: "complete", content: { kind: "message", text: "hi back" } },
  ];
  expect(sceneTail({ activeTranscript: presentation })).toBe(
    dedent(`
      ❯ hello there


      ◆ hi back

      ────────────────────────────────────────────────────────────
      ❯ Ask anything…
      ────────────────────────────────────────────────────────────
        acolyte · main · gpt-5
    `),
  );
});

test("rows, pending, and tasklist live region renders in order with indent", () => {
  const originalNow = Date.now;
  Date.now = () => 5000;
  try {
    const presentation: TranscriptRow[] = [
      { id: "r1", kind: "user", status: "complete", content: { kind: "message", text: "do the thing" } },
      { id: "r2", kind: "assistant", status: "complete", content: { kind: "message", text: "on it" } },
      { id: "cl", kind: "tool", status: "active", content: { kind: "tasklist", output: tasklist } },
    ];
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
    expect(scene).toBe(
      dedent(`
        ❯ do the thing


        ◆ on it

        ◆ Working… (5s · 1 tool)

          Plan 1/2
            ◈ step two

        ────────────────────────────────────────────────────────────
        ❯ Ask anything…
        ────────────────────────────────────────────────────────────
          acolyte · main · gpt-5
      `),
    );
  } finally {
    Date.now = originalNow;
  }
});

test("queued messages live region renders below the pending indicator", () => {
  const originalNow = Date.now;
  Date.now = () => 5000;
  try {
    const presentation: TranscriptRow[] = [
      { id: "r1", kind: "user", status: "complete", content: { kind: "message", text: "first" } },
    ];
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
    expect(scene).toBe(
      dedent(`
        ❯ first


        ◆ Working… (5s)

        ❯ next up

        ────────────────────────────────────────────────────────────
        ❯ Ask anything…
        ────────────────────────────────────────────────────────────
          acolyte · main · gpt-5
      `),
    );
  } finally {
    Date.now = originalNow;
  }
});
