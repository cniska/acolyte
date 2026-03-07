import { describe, expect, test } from "bun:test";
import { createFinalAssistantRows } from "./chat-message-handler-finalize";

describe("chat-message-handler-finalize", () => {
  test("createFinalAssistantRows suppresses redundant assistant header echoes", () => {
    const result = createFinalAssistantRows({
      rows: [{ id: "a", role: "assistant", content: "Created src/a.ts" }] as never,
      streamedAssistantText: "Created src/a.ts",
      committedStreamingText: "Created src/a.ts",
      toolHeaders: new Set(["Created src/a.ts"]),
    });
    expect(result).toEqual([]);
  });

  test("createFinalAssistantRows keeps non-redundant assistant rows", () => {
    const result = createFinalAssistantRows({
      rows: [{ id: "b", role: "assistant", content: "All done." }] as never,
      streamedAssistantText: "",
      committedStreamingText: "",
      toolHeaders: new Set(["Created src/a.ts"]),
    });
    expect(result.map((r) => r.id)).toEqual(["b"]);
  });
});
