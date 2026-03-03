import { describe, expect, test } from "bun:test";
import type { Message } from "./chat-message";
import { toRows } from "./chat-session";

describe("chat session helpers", () => {
  test("toRows keeps only user/assistant and applies limit", () => {
    const messages: Message[] = [
      { id: "1", role: "system", content: "x", timestamp: "" },
      { id: "2", role: "user", content: "u1", timestamp: "" },
      { id: "3", role: "assistant", content: "a1", timestamp: "" },
      { id: "4", role: "user", content: "u2", timestamp: "" },
    ];
    const rows = toRows(messages, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.content).toBe("a1");
    expect(rows[1]?.content).toBe("u2");
  });
});
