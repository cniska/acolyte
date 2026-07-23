import { describe, expect, test } from "bun:test";
import type { TranscriptRow, TranscriptStatus } from "./chat-transcript-contract";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { layoutChatViewport } from "./terminal-chat-layout";
import { type TerminalStyleRole, terminalTheme } from "./terminal-theme";

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

// The role carried by the text span of a system notice row. The ANSI-stripped parity gate
// cannot see color, so this asserts the semantic role directly — the seam the F2 regression
// (a muted error notice) slipped through.
function noticeTextRole(status: TranscriptStatus, text: string): TerminalStyleRole | undefined {
  const row: TranscriptRow = { id: "row_notice", kind: "system", status, content: { kind: "message", text } };
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [row],
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
  const section = scene.sections?.find((item) => item.id === "row_notice");
  const spans = scene.lines.slice(section?.lineStart, section?.lineEnd).flatMap((line) => line.spans);
  return spans.find((span) => span.text.includes(text))?.role;
}

describe("system notice color", () => {
  test("an error notice colors its text with the error role", () => {
    expect(noticeTextRole("error", "boom")).toBe("error");
  });

  test("a warning notice colors its text with the warning role", () => {
    expect(noticeTextRole("warning", "sink is dark")).toBe("warning");
  });

  test("a plain system notice keeps muted text", () => {
    expect(noticeTextRole("complete", "resuming session")).toBe("muted");
  });
});
