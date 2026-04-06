import { describe, expect, test } from "bun:test";
import { parseSessionState } from "./storage";

describe("storage", () => {
  test("parseSessionState drops sessions missing tokenUsage", () => {
    const normalized = parseSessionState({
      activeSessionId: "sess_1",
      sessions: [
        {
          id: "sess_1",
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:00.000Z",
          model: "gpt-5-mini",
          title: "New Session",
          messages: [],
        },
      ] as never,
    });

    expect(normalized.sessions).toHaveLength(0);
  });

  test("parseSessionState preserves existing tokenUsage entries", () => {
    const normalized = parseSessionState({
      activeSessionId: "sess_1",
      sessions: [
        {
          id: "sess_1",
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:00.000Z",
          model: "gpt-5-mini",
          title: "New Session",
          messages: [],
          tokenUsage: [
            {
              id: "msg_1",
              usage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
              },
              modelCalls: 2,
            },
          ],
        },
      ],
    });

    expect(normalized.sessions).toHaveLength(1);
    expect(normalized.sessions[0]?.tokenUsage).toHaveLength(1);
    expect(normalized.sessions[0]?.tokenUsage[0]?.usage.totalTokens).toBe(15);
    expect(normalized.sessions[0]?.tokenUsage[0]?.modelCalls).toBe(2);
  });

  test("parseSessionState defaults missing message kind to text", () => {
    const normalized = parseSessionState({
      activeSessionId: "sess_1",
      sessions: [
        {
          id: "sess_1",
          createdAt: "2026-02-24T00:00:00.000Z",
          updatedAt: "2026-02-24T00:00:00.000Z",
          model: "gpt-5-mini",
          title: "New Session",
          messages: [
            {
              id: "msg_1",
              role: "assistant",
              content: "hello",
              timestamp: "2026-02-24T00:00:01.000Z",
            },
          ],
          tokenUsage: [],
        },
      ] as never,
    });

    expect(normalized.sessions[0]?.messages[0]?.kind).toBe("text");
  });
});
