import { describe, expect, test } from "bun:test";
import { formatSessionList, sessionsRows } from "./chat-commands-sessions";
import { isCommandOutput } from "./chat-contract";
import { createSession, createSessionState } from "./test-utils";

describe("chat-commands-sessions", () => {
  test("sessionsRows returns commandOutput with header and list", () => {
    const sessionState = createSessionState({
      activeSessionId: "sess_aaaa1111",
      sessions: [createSession({ id: "sess_aaaa1111", title: "First" })],
    });
    const [row] = sessionsRows(sessionState, 10);
    const content = row?.content;
    expect(isCommandOutput(content) && content.header).toBe("Sessions 1");
    expect(isCommandOutput(content) && content.list?.some((line) => line.includes("● sess_aaaa1111"))).toBe(true);
    expect(isCommandOutput(content) && content.list?.some((line) => line.includes("First"))).toBe(true);
  });

  test("formatSessionList marks active session", () => {
    const sessionState = createSessionState({
      activeSessionId: "sess_aaaa1111",
      sessions: [
        createSession({ id: "sess_aaaa1111", title: "First" }),
        createSession({ id: "sess_bbbb2222", title: "Second" }),
      ],
    });
    const lines = formatSessionList(sessionState);
    expect(lines[0]?.startsWith("● ")).toBe(true);
    expect(lines[1]?.startsWith("  ")).toBe(true);
  });
});
