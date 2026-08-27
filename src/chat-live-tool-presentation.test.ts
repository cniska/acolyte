import { afterEach, expect, jest, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import { createMessageStreamState } from "./chat-message-handler-stream";
import type { TranscriptRow } from "./chat-transcript-contract";

afterEach(() => {
  jest.useRealTimers();
});

test("live tool events publish canonical status without header state", () => {
  jest.useFakeTimers();
  const rows: ChatRow[] = [];
  let presentation: TranscriptRow[] = [];
  const state = createMessageStreamState({
    setRows: (updater) => rows.splice(0, rows.length, ...updater(rows)),
    setTranscriptPresentation: (updater) => {
      presentation = updater(presentation);
    },
    surface: "transcript",
  });
  state.onOutput({
    toolCallId: "call_1",
    toolName: "file-read",
    content: { kind: "tool-header", labelKey: "tool.label.file_read", detail: "src/a.ts" },
  });
  expect(presentation).toMatchObject([{ kind: "tool", status: "active", content: { kind: "tool-output" } }]);
  // The outcome lands with the result, on nothing's wait: the row is marked as the call ends.
  state.onToolResult({ toolCallId: "call_1", toolName: "file-read" });
  expect(presentation[0]?.status).toBe("success");
  expect(presentation[0]?.content).toEqual({
    kind: "tool-output",
    output: { parts: [{ kind: "tool-header", labelKey: "tool.label.file_read", detail: "src/a.ts" }] },
  });
  state.dispose();
});

test("a running tool's live output is part of the rendered presentation", () => {
  jest.useFakeTimers();
  const rows: ChatRow[] = [];
  let presentation: TranscriptRow[] = [];
  const state = createMessageStreamState({
    setRows: (updater) => rows.splice(0, rows.length, ...updater(rows)),
    setTranscriptPresentation: (updater) => {
      presentation = updater(presentation);
    },
    surface: "transcript",
  });
  state.onOutput({
    toolCallId: "call_1",
    toolName: "shell-run",
    content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "bun run build" },
  });
  state.onOutput({
    toolCallId: "call_1",
    toolName: "shell-run",
    content: { kind: "shell-output", stream: "stdout", text: "compiling" },
    transient: true,
  });
  expect(presentation[0]?.content).toEqual({
    kind: "tool-output",
    output: {
      parts: [
        { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "bun run build" },
        { kind: "shell-output", stream: "stdout", text: "compiling" },
      ],
    },
  });
  state.onOutput({
    toolCallId: "call_1",
    toolName: "shell-run",
    content: { kind: "shell-output", stream: "stdout", text: "done" },
  });
  // Settled output after the row's first part is revealed on the drip tick, not on arrival.
  jest.advanceTimersByTime(1000);
  expect(presentation[0]?.content).toEqual({
    kind: "tool-output",
    output: {
      parts: [
        { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "bun run build" },
        { kind: "shell-output", stream: "stdout", text: "done" },
      ],
    },
  });
  state.dispose();
});
