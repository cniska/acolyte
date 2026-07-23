import { describe, expect, test } from "bun:test";
import type { TranscriptContent, TranscriptRow, TranscriptStatus } from "./chat-transcript-contract";
import type { PendingPresentation } from "./chat-viewport-contract";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { layoutChatViewport } from "./terminal-chat-layout";
import { terminalTheme } from "./terminal-theme";

type RowKind = TranscriptRow["kind"];

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

const message = (text: string): TranscriptContent => ({ kind: "message", text });
const toolOutput: TranscriptContent = {
  kind: "tool-output",
  output: { parts: [{ kind: "tool-header", labelKey: "read" }] },
};
const commandOutput: TranscriptContent = { kind: "command-output", output: { header: "Status", sections: [] } };
const tasklist: TranscriptContent = {
  kind: "tasklist",
  output: { groupId: "g1", groupTitle: "Plan", items: [{ id: "i1", label: "step", status: "in_progress", order: 0 }] },
};

function finalizedById(rows: TranscriptRow[], pending: PendingPresentation | null = null): Map<string, boolean> {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: rows,
    pending,
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
  return new Map((scene.sections ?? []).map((section) => [section.id, section.finalized]));
}

function finalizedForRow(kind: RowKind, status: TranscriptStatus, content: TranscriptContent): boolean {
  const finalized = finalizedById([{ id: "row_target", kind, status, content }]).get("row_target");
  if (finalized === undefined) throw new Error("row section was not laid out");
  return finalized;
}

// A section may enter static scrollback only once its bytes can never change again.
// Streaming rows (active prose, active tools, tasklists, pending) must never finalize;
// settled rows must, or they repaint forever. This table is the promotion-integrity gate.
const cases: Array<{
  name: string;
  kind: RowKind;
  status: TranscriptStatus;
  content: TranscriptContent;
  finalized: boolean;
}> = [
  { name: "completed user message", kind: "user", status: "complete", content: message("hi"), finalized: true },
  { name: "streaming user message", kind: "user", status: "active", content: message("hi"), finalized: false },
  {
    name: "completed assistant message",
    kind: "assistant",
    status: "complete",
    content: message("ok"),
    finalized: true,
  },
  {
    name: "streaming assistant message",
    kind: "assistant",
    status: "active",
    content: message("ok"),
    finalized: false,
  },
  { name: "errored assistant message", kind: "assistant", status: "error", content: message("ok"), finalized: true },
  { name: "completed tool output", kind: "tool", status: "complete", content: toolOutput, finalized: true },
  { name: "running tool output", kind: "tool", status: "active", content: toolOutput, finalized: false },
  { name: "errored tool output", kind: "tool", status: "error", content: toolOutput, finalized: true },
  { name: "command output", kind: "system", status: "complete", content: commandOutput, finalized: true },
  { name: "status outcome row", kind: "status", status: "success", content: message("Worked 5s"), finalized: true },
  { name: "task outcome row", kind: "task", status: "success", content: message("Built"), finalized: true },
  { name: "active tasklist", kind: "tool", status: "active", content: tasklist, finalized: false },
  { name: "completed tasklist", kind: "tool", status: "complete", content: tasklist, finalized: false },
];

describe("layoutChatViewport finalization eligibility", () => {
  for (const testCase of cases) {
    test(`${testCase.name} → finalized=${testCase.finalized}`, () => {
      expect(finalizedForRow(testCase.kind, testCase.status, testCase.content)).toBe(testCase.finalized);
    });
  }

  test("the header is always finalized", () => {
    expect(finalizedById([]).get("header")).toBe(true);
  });

  test("the composer is never finalized", () => {
    expect(finalizedById([]).get("composer")).toBe(false);
  });

  test("the pending section is never finalized", () => {
    const pending: PendingPresentation = {
      state: { kind: "running", toolCalls: 0 },
      frame: 0,
      startedAt: 0,
      queuedMessages: [],
      runningUsage: null,
    };
    expect(finalizedById([], pending).get("pending")).toBe(false);
  });
});
