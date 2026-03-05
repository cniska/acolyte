import { describe, expect, test } from "bun:test";
import { newMessage } from "./chat-session";
import { handlePrompt } from "./cli-prompt";
import type { Client } from "./client";
import type { Session } from "./session-contract";

describe("cli-prompt", () => {
  test("newMessage creates a timestamped chat message", () => {
    const message = newMessage("user", "hello");
    expect(message.id.startsWith("msg_")).toBe(true);
    expect(message.role).toBe("user");
    expect(message.content).toBe("hello");
    expect(Number.isNaN(Date.parse(message.timestamp))).toBe(false);
  });

  test("handlePrompt marks assistant message as tool_payload when tools were used", async () => {
    const session: Session = {
      id: "sess_test0001",
      createdAt: "2026-03-05T10:00:00.000Z",
      updatedAt: "2026-03-05T10:00:00.000Z",
      model: "gpt-5-mini",
      title: "New Session",
      messages: [],
      tokenUsage: [],
    };
    const client: Client = {
      replyStream: async () => ({ output: "done", model: "gpt-5-mini", toolCalls: ["read-file"] }),
      status: async () => ({}),
      setPermissionMode: async () => {},
      taskStatus: async () => null,
    };

    const ok = await handlePrompt("hello", session, client);
    expect(ok).toBe(true);
    expect(session.messages[session.messages.length - 1]?.kind).toBe("tool_payload");
  });
});
