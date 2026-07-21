import { expect, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import type { TranscriptRow } from "./chat-transcript-contract";
import { createTranscriptPublisher } from "./chat-transcript-publisher";

test("publishes command rows to semantic presentation with stable ids and lifecycle", () => {
  let rows: ChatRow[] = [];
  let presentation: TranscriptRow[] = [];
  const publish = createTranscriptPublisher({
    setRows: (updater) => {
      rows = updater(rows);
    },
    setPresentation: (updater) => {
      presentation = updater(presentation);
    },
  });
  publish(() => [
    { id: "row_system", kind: "system", content: "Unknown command" },
    { id: "row_status", kind: "status", content: "Worked" },
    { id: "row_task", kind: "task", content: "Interrupted" },
  ]);
  expect(rows.map((row) => row.id)).toEqual(["row_system", "row_status", "row_task"]);
  expect(presentation).toEqual([
    { id: "row_system", kind: "system", lifecycle: "complete", content: { kind: "message", text: "Unknown command" } },
    { id: "row_status", kind: "status", lifecycle: "success", content: { kind: "message", text: "Worked" } },
    { id: "row_task", kind: "task", lifecycle: "complete", content: { kind: "message", text: "Interrupted" } },
  ]);
});
