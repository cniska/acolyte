import { expect, test } from "bun:test";
import { type ActiveTranscriptState, createTranscriptPublisher } from "./chat-transcript-publisher";

test("publishes command rows to semantic presentation with stable ids and lifecycle", () => {
  let transcript: ActiveTranscriptState = { rows: [], presentation: [] };
  const publish = createTranscriptPublisher({
    setTranscript: (updater) => {
      transcript = updater(transcript);
    },
  });
  publish(() => [
    { id: "row_system", kind: "system", content: "Unknown command" },
    { id: "row_status", kind: "status", content: "Worked" },
    { id: "row_task", kind: "task", content: "Interrupted" },
  ]);
  expect(transcript.rows.map((row) => row.id)).toEqual(["row_system", "row_status", "row_task"]);
  expect(transcript.presentation).toEqual([
    { id: "row_system", kind: "system", lifecycle: "complete", content: { kind: "message", text: "Unknown command" } },
    { id: "row_status", kind: "status", lifecycle: "success", content: { kind: "message", text: "Worked" } },
    { id: "row_task", kind: "task", lifecycle: "complete", content: { kind: "message", text: "Interrupted" } },
  ]);
});
