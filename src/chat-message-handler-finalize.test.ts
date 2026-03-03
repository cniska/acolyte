import { describe, expect, test } from "bun:test";
import { buildFinalAssistantRows, finalizeToolProgressRows } from "./chat-message-handler-finalize";

describe("chat-message-handler-finalize", () => {
  test("finalizeToolProgressRows removes pending stream row and expands empty run-command rows", () => {
    const rows = [
      { id: "stream_1", role: "assistant", content: "partial" },
      { id: "tool_1", role: "assistant", content: "Run echo hi", style: "toolProgress", toolName: "run-command" },
    ] as const;

    const result = finalizeToolProgressRows(rows as never, "stream_1");
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toContain("(No output)");
  });

  test("buildFinalAssistantRows suppresses redundant assistant header echoes", () => {
    const result = buildFinalAssistantRows({
      rows: [{ id: "a", role: "assistant", content: "Created src/a.ts" }] as never,
      streamedAssistantText: "Created src/a.ts",
      committedStreamingText: "Created src/a.ts",
      toolHeaders: new Set(["Created src/a.ts"]),
    });
    expect(result).toEqual([]);
  });

  test("buildFinalAssistantRows keeps non-redundant assistant rows", () => {
    const result = buildFinalAssistantRows({
      rows: [{ id: "b", role: "assistant", content: "All done." }] as never,
      streamedAssistantText: "",
      committedStreamingText: "",
      toolHeaders: new Set(["Created src/a.ts"]),
    });
    expect(result.map((r) => r.id)).toEqual(["b"]);
  });
});
