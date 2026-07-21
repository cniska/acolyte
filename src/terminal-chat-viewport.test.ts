import { expect, test } from "bun:test";
import type { TranscriptRow } from "./chat-transcript-contract";
import { layoutChatViewport } from "./terminal-chat-layout";
import type { TerminalScene } from "./terminal-scene-contract";
import { terminalTheme } from "./terminal-theme";

function layoutTranscript(transcript: TranscriptRow[]): TerminalScene {
  return layoutChatViewport({
    presentation: {
      header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
      transcript,
      pending: null,
      composer: {
        input: { text: "", cursor: 0 },
        placeholder: "Ask",
        focus: true,
        caretVisible: true,
        revision: 0,
        ctrlCPending: false,
        prompt: "chat",
        cursorLine: 0,
        activeIdentity: null,
        picker: null,
        suggestions: { kind: "none" },
        showHelp: false,
        helpEntries: [],
        helpBreakpoint: 92,
        status: [],
      },
      sections: [],
    },
    constraints: { columns: 40, rows: 20 },
    theme: terminalTheme,
    now: 0,
  });
}

function markerAndTextRoles(scene: TerminalScene, rowId: string): { marker?: string; text?: string } {
  const section = scene.sections?.find((s) => s.id === rowId);
  const spans = section ? scene.lines[section.lineStart]?.spans : undefined;
  return { marker: spans?.[0]?.role, text: spans?.[1]?.role };
}

test("status and task rows render a muted body with an outcome-colored marker", () => {
  const scene = layoutTranscript([
    { id: "row_worked", kind: "status", status: "success", content: { kind: "message", text: "Worked 2s" } },
    { id: "row_failed", kind: "task", status: "error", content: { kind: "message", text: "Failed" } },
    { id: "row_cancel", kind: "task", status: "cancelled", content: { kind: "message", text: "Interrupted" } },
  ]);
  expect(markerAndTextRoles(scene, "row_worked")).toEqual({ marker: "success", text: "muted" });
  expect(markerAndTextRoles(scene, "row_failed")).toEqual({ marker: "error", text: "muted" });
  expect(markerAndTextRoles(scene, "row_cancel")).toEqual({ marker: "cancelled", text: "muted" });
});

test("viewport layout orders finalized transcript before mutable pending and composer sections", () => {
  const scene = layoutChatViewport({
    presentation: {
      header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
      transcript: [{ id: "row_1", kind: "assistant", status: "complete", content: { kind: "message", text: "hello" } }],
      pending: { state: { kind: "running" }, frame: 0, startedAt: 0, queuedMessages: [], runningUsage: null },
      composer: {
        input: { text: "ask", cursor: 3 },
        placeholder: "Ask",
        focus: true,
        caretVisible: true,
        revision: 0,
        ctrlCPending: false,
        prompt: "chat",
        cursorLine: 0,
        activeIdentity: null,
        picker: null,
        suggestions: { kind: "none" },
        showHelp: false,
        helpEntries: [],
        helpBreakpoint: 92,
        status: [],
      },
      sections: [],
    },
    constraints: { columns: 40, rows: 20 },
    theme: terminalTheme,
    now: 0,
  });
  expect(scene.sections?.map((section) => [section.id, section.finalized])).toEqual([
    ["header", true],
    ["row_1", true],
    ["pending", false],
    ["composer", false],
  ]);
  expect(scene.cursor?.row).toBeGreaterThan(0);
});
