import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "./chat-contract";
import { searchMessages } from "./session-ops";

function msg(id: string, content: string, kind?: ChatMessage["kind"], role?: ChatMessage["role"]): ChatMessage {
  return {
    id: `msg_${id}`,
    role: role ?? "user",
    content,
    kind: kind ?? "text",
    timestamp: "2026-04-15T10:00:00.000Z",
  };
}

describe("searchMessages", () => {
  test("returns matching messages in chronological order", () => {
    const messages = [msg("1", "fix the auth bug"), msg("2", "done with tests"), msg("3", "auth flow looks good")];
    const results = searchMessages(messages, "auth");
    expect(results.map((r) => r.id)).toEqual(["msg_1", "msg_3"]);
  });

  test("returns empty array on no match", () => {
    const messages = [msg("1", "fix the auth bug"), msg("2", "done with tests")];
    expect(searchMessages(messages, "database")).toEqual([]);
  });

  test("respects limit", () => {
    const messages = [msg("1", "error in foo"), msg("2", "error in bar"), msg("3", "error in baz")];
    const results = searchMessages(messages, "error", { limit: 2 });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual(["msg_1", "msg_2"]);
  });

  test("matches case-insensitively", () => {
    const messages = [msg("1", "TypeError: null is not a function")];
    const results = searchMessages(messages, "typeerror");
    expect(results).toHaveLength(1);
  });

  test("skips status messages", () => {
    const messages = [msg("1", "searching files", "status"), msg("2", "searching files", "text")];
    const results = searchMessages(messages, "searching");
    expect(results.map((r) => r.id)).toEqual(["msg_2"]);
  });

  test("includes tool_payload messages", () => {
    const messages = [msg("1", "stdout: connection refused", "tool_payload")];
    const results = searchMessages(messages, "connection refused");
    expect(results).toHaveLength(1);
  });
});
