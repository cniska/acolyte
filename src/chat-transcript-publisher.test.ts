import { expect, test } from "bun:test";
import { type ActiveTranscriptState, createTranscriptPublisher } from "./chat-transcript-publisher";

test("publishes command rows to semantic presentation with stable ids and status", () => {
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
    { id: "row_system", kind: "system", status: "complete", content: { kind: "message", text: "Unknown command" } },
    { id: "row_status", kind: "status", status: "success", content: { kind: "message", text: "Worked" } },
    { id: "row_task", kind: "task", status: "complete", content: { kind: "message", text: "Interrupted" } },
  ]);
});

test("fills every missing live row without replacing stream-owned presentation", () => {
  let transcript: ActiveTranscriptState = {
    rows: [],
    presentation: [
      { id: "row_tool", kind: "tool", status: "active", content: { kind: "tool-output", output: { parts: [] } } },
    ],
  };
  const publish = createTranscriptPublisher({
    setTranscript: (updater) => {
      transcript = updater(transcript);
    },
  });
  publish(() => [
    { id: "row_user", kind: "user", content: "Inspect" },
    { id: "row_assistant", kind: "assistant", content: "Looking" },
    { id: "row_tool", kind: "tool", content: { parts: [] } },
    { id: "row_status", kind: "status", content: "Worked" },
    { id: "row_task", kind: "task", content: { groupId: "group_1", groupTitle: "Plan", items: [] } },
    { id: "row_system", kind: "system", content: "Notice" },
  ]);
  expect(transcript.presentation.map((row) => row.id)).toEqual([
    "row_tool",
    "row_user",
    "row_assistant",
    "row_status",
    "row_task",
    "row_system",
  ]);
  expect(transcript.presentation.find((row) => row.id === "row_tool")?.status).toBe("active");
  expect(transcript.presentation.find((row) => row.id === "row_task")?.content).toEqual({
    kind: "tasklist",
    output: { groupId: "group_1", groupTitle: "Plan", items: [] },
  });
});
