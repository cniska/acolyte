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
  const spans = (section ? scene.lines[section.lineStart]?.spans : undefined) ?? [];
  const markerIndex = spans.findIndex((span) => /\S/.test(span.text));
  return { marker: spans[markerIndex]?.role, text: spans[markerIndex + 1]?.role };
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

test("a user message is framed and separated by exactly one blank line", () => {
  const scene = layoutTranscript([
    { id: "row_a", kind: "assistant", status: "complete", content: { kind: "message", text: "before" } },
    { id: "row_user", kind: "user", status: "complete", content: { kind: "message", text: "hello" } },
    { id: "row_b", kind: "assistant", status: "complete", content: { kind: "message", text: "after" } },
  ]);
  const section = scene.sections?.find((s) => s.id === "row_user");
  if (!section) throw new Error("user section missing");
  const row = (index: number): string => (scene.lines[index]?.spans ?? []).map((span) => span.text).join("");
  expect(row(section.lineStart)).toContain("╭");
  expect(row(section.lineEnd - 1)).toContain("╰");
  expect(row(section.lineStart - 1).trim()).toBe("");
  expect(row(section.lineStart - 2).trim()).not.toBe("");
  expect(row(section.lineEnd).trim()).toBe("");
  expect(row(section.lineEnd + 1).trim()).not.toBe("");
});

test("a control command echoes on one line, unframed, one blank line from its neighbors", () => {
  const scene = layoutTranscript([
    { id: "row_a", kind: "assistant", status: "complete", content: { kind: "message", text: "before" } },
    { id: "row_cmd", kind: "command", status: "complete", content: { kind: "message", text: "/status" } },
    { id: "row_b", kind: "assistant", status: "complete", content: { kind: "message", text: "after" } },
  ]);
  const section = scene.sections?.find((s) => s.id === "row_cmd");
  if (!section) throw new Error("command section missing");
  const row = (index: number): string => (scene.lines[index]?.spans ?? []).map((span) => span.text).join("");
  expect(section.lineEnd - section.lineStart).toBe(1);
  expect(row(section.lineStart)).toContain("❯ /status");
  expect(row(section.lineStart)).not.toContain("╭");
  expect(row(section.lineStart - 1).trim()).toBe("");
  expect(row(section.lineStart - 2).trim()).not.toBe("");
  expect(row(section.lineEnd).trim()).toBe("");
  expect(row(section.lineEnd + 1).trim()).not.toBe("");
});

test("a wrapped command aligns its continuation under the first line's text", () => {
  const scene = layoutTranscript([
    {
      id: "row_cmd",
      status: "complete",
      kind: "command",
      content: { kind: "message", text: "/memory add --project the release script owns the gates and the changelog" },
    },
  ]);
  const section = scene.sections?.find((s) => s.id === "row_cmd");
  if (!section) throw new Error("command section missing");
  const rows = scene.lines
    .slice(section.lineStart, section.lineEnd)
    .map((line) => line.spans.map((span) => span.text).join(""));
  expect(rows.length).toBeGreaterThan(1);
  // The marker on the first line and its width in spaces on the rest, so text starts in one column.
  for (const row of rows) expect(/^ {3}(?:❯ | {2})\S/.test(row)).toBe(true);
});

test("the prompt marker sits in one column across commands, messages, and the composer", () => {
  const scene = layoutTranscript([
    { id: "row_cmd", kind: "command", status: "complete", content: { kind: "message", text: "/status" } },
    { id: "row_user", kind: "user", status: "complete", content: { kind: "message", text: "ship it" } },
  ]);
  const columns = scene.lines
    .map((line) => line.spans.map((span) => span.text).join(""))
    .filter((text) => text.includes("❯"))
    .map((text) => text.indexOf("❯"));
  expect(columns.length).toBe(3);
  expect(new Set(columns).size).toBe(1);
});
