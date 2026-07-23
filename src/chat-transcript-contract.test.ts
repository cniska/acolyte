import { describe, expect, test } from "bun:test";
import { migrateLegacyChatRow, projectActiveTranscript, transcriptRowSchema } from "./chat-transcript-contract";

describe("semantic transcript contract", () => {
  test("migrates each legacy payload into a discriminated semantic payload", () => {
    expect(migrateLegacyChatRow({ id: "row_1", kind: "assistant", content: "hello" })).toEqual({
      id: "row_1",
      kind: "assistant",
      status: "complete",
      content: { kind: "message", text: "hello" },
    });
    expect(migrateLegacyChatRow({ id: "row_2", kind: "tool", content: { parts: [] } }).content).toEqual({
      kind: "tool-output",
      output: { parts: [] },
    });
  });

  test("derives status and task status from the row outcome", () => {
    expect(
      migrateLegacyChatRow({ id: "row_1", kind: "status", content: "Worked 2s", style: { outcome: "success" } }).status,
    ).toBe("success");
    expect(
      migrateLegacyChatRow({ id: "row_2", kind: "task", content: "Failed", style: { outcome: "error" } }).status,
    ).toBe("error");
    expect(
      migrateLegacyChatRow({ id: "row_3", kind: "task", content: "Interrupted", style: { outcome: "cancelled" } })
        .status,
    ).toBe("cancelled");
    expect(migrateLegacyChatRow({ id: "row_4", kind: "status", content: "Worked 2s" }).status).toBe("success");
    expect(migrateLegacyChatRow({ id: "row_5", kind: "task", content: "note" }).status).toBe("complete");
  });

  test("projects active rows in their live order with semantic enrichment", () => {
    expect(
      projectActiveTranscript(
        [
          { id: "row_user", kind: "user", content: "inspect" },
          { id: "row_tool", kind: "tool", content: { parts: [] } },
          { id: "row_status", kind: "status", content: "Worked 2s" },
        ],
        [
          {
            id: "row_user",
            kind: "user",
            status: "complete",
            content: { kind: "message", text: "inspect" },
          },
          {
            id: "row_tool",
            kind: "tool",
            status: "active",
            content: { kind: "tool-output", output: { parts: [] } },
          },
          {
            id: "row_promoted",
            kind: "assistant",
            status: "complete",
            content: { kind: "message", text: "already static" },
          },
        ],
      ),
    ).toEqual([
      { id: "row_user", kind: "user", status: "complete", content: { kind: "message", text: "inspect" } },
      { id: "row_tool", kind: "tool", status: "active", content: { kind: "tool-output", output: { parts: [] } } },
    ]);
  });

  test("accepts only explicit status and semantic content", () => {
    expect(
      transcriptRowSchema.safeParse({
        id: "row_1",
        kind: "assistant",
        status: "active",
        content: { kind: "message", text: "working" },
      }).success,
    ).toBe(true);
    expect(transcriptRowSchema.safeParse({ id: "row_1", kind: "assistant", content: "working" }).success).toBe(false);
  });
});
