import { expect, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import { createMessageStreamState } from "./chat-message-handler-stream";
import type { TranscriptRow } from "./chat-transcript-contract";

test("live tool events publish canonical lifecycle without header state", () => {
  const rows: ChatRow[] = [];
  let presentation: TranscriptRow[] = [];
  const state = createMessageStreamState({
    setRows: (updater) => rows.splice(0, rows.length, ...updater(rows)),
    setTranscriptPresentation: (updater) => {
      presentation = updater(presentation);
    },
  });
  state.onOutput({
    toolCallId: "call_1",
    toolName: "file-read",
    content: { kind: "tool-header", labelKey: "tool.label.file_read", detail: "src/a.ts" },
  });
  expect(presentation).toMatchObject([{ kind: "tool", lifecycle: "active", content: { kind: "tool-output" } }]);
  state.onToolResult({ toolCallId: "call_1", toolName: "file-read" });
  expect(presentation[0]?.lifecycle).toBe("success");
  expect(presentation[0]?.content).toEqual({
    kind: "tool-output",
    output: { parts: [{ kind: "tool-header", labelKey: "tool.label.file_read", detail: "src/a.ts" }] },
  });
  state.dispose();
});
