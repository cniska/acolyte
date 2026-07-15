import { describe, expect, test } from "bun:test";
import { parseSessionState } from "./session-store";

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

  test("parseSessionState backfills missing promptBreakdown skillTokens", () => {
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
              promptBreakdown: {
                budgetTokens: 100,
                usedTokens: 10,
                systemTokens: 4,
                toolTokens: 3,
                memoryTokens: 1,
                messageTokens: 2,
              },
            },
          ],
        },
      ] as never,
    });

    expect(normalized.sessions).toHaveLength(1);
    expect(normalized.sessions[0]?.tokenUsage[0]?.promptBreakdown?.skillTokens).toBe(0);
  });

  const validSession = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    createdAt: "2026-02-24T00:00:00.000Z",
    updatedAt: "2026-02-24T00:00:00.000Z",
    model: "gpt-5-mini",
    title: "New Session",
    messages: [],
    tokenUsage: [],
    ...extra,
  });

  test("parseSessionState salvages a session with a corrupt transcript instead of dropping it", () => {
    const normalized = parseSessionState({
      activeSessionId: "sess_1",
      sessions: [validSession("sess_1", { transcript: [{ id: "row_1", kind: "not-a-kind", content: "x" }] })],
    });

    expect(normalized.sessions).toHaveLength(1);
    expect(normalized.sessions[0]?.id).toBe("sess_1");
    expect(normalized.sessions[0]?.transcript).toBeUndefined();
  });

  test("parseSessionState keeps healthy sessions when a sibling is unsalvageable", () => {
    const normalized = parseSessionState({
      activeSessionId: "sess_good",
      sessions: [
        validSession("sess_good"),
        { id: "sess_bad", model: "gpt-5-mini" }, // missing required fields, no transcript to strip
        validSession("sess_good2", { transcript: [{ id: "row_x", kind: "assistant", content: "hi" }] }),
      ],
    });

    const ids = normalized.sessions.map((s) => s.id);
    expect(ids).toEqual(["sess_good", "sess_good2"]);
    expect(normalized.activeSessionId).toBe("sess_good");
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
