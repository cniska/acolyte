import { describe, expect, test } from "bun:test";
import { migrateLegacyChatRow, transcriptRowSchema } from "./chat-transcript-contract";
import { parseSessionState } from "./session-store";

describe("semantic transcript contract", () => {
  test("migrates each legacy payload into a discriminated semantic payload", () => {
    expect(migrateLegacyChatRow({ id: "row_1", kind: "assistant", content: "hello" })).toEqual({
      id: "row_1",
      kind: "assistant",
      lifecycle: "complete",
      content: { kind: "message", text: "hello" },
    });
    expect(migrateLegacyChatRow({ id: "row_2", kind: "tool", content: { parts: [] } }).content).toEqual({
      kind: "tool-output",
      output: { parts: [] },
    });
  });

  test("accepts only explicit lifecycle and semantic content", () => {
    expect(
      transcriptRowSchema.safeParse({
        id: "row_1",
        kind: "assistant",
        lifecycle: "active",
        content: { kind: "message", text: "working" },
      }).success,
    ).toBe(true);
    expect(transcriptRowSchema.safeParse({ id: "row_1", kind: "assistant", content: "working" }).success).toBe(false);
  });

  test("preserves legacy transcript rows and records their semantic migration", () => {
    const state = parseSessionState({
      sessions: [
        {
          id: "sess_1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          model: "test",
          title: "Test",
          messages: [],
          tokenUsage: [],
          transcript: [{ id: "row_1", kind: "user", content: "hello" }],
        },
      ],
    });
    expect(state.sessions[0]?.transcript).toEqual([{ id: "row_1", kind: "user", content: "hello" }]);
    expect(state.sessions[0]?.transcriptPresentation).toEqual([
      { id: "row_1", kind: "user", lifecycle: "complete", content: { kind: "message", text: "hello" } },
    ]);
  });
});
