import { describe, expect, test } from "bun:test";
import { newMessage } from "./chat-session";

describe("cli-prompt", () => {
  test("newMessage creates a timestamped chat message", () => {
    const message = newMessage("user", "hello");
    expect(message.id.startsWith("msg_")).toBe(true);
    expect(message.role).toBe("user");
    expect(message.content).toBe("hello");
    expect(Number.isNaN(Date.parse(message.timestamp))).toBe(false);
  });
});
