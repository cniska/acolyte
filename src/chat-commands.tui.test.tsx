import { describe, expect, test } from "bun:test";
import { ChatTranscript } from "./chat-transcript";
import { createClient, createMessageHandlerHarness, createSession, createSessionState, dedent } from "./test-utils";
import { DEFAULT_TERMINAL_WIDTH } from "./tui/constants";
import { renderPlain } from "./tui-test-utils";

function renderTranscript(
  rows: Parameters<typeof ChatTranscript>[0]["rows"],
  columns = DEFAULT_TERMINAL_WIDTH,
): string {
  return dedent(renderPlain(<ChatTranscript rows={rows} pendingFrame={0} />, columns));
}

describe("chat slash command visual regression", () => {
  test("renders /status transcript output", async () => {
    const { handleMessage, allRows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({
          providers: ["openai"],
          model: "gpt-5-mini",
        }),
      }),
    });

    await handleMessage("/status");

    expect(renderTranscript(allRows)).toBe(
      dedent(`
        ❯ /status

          Status

          Providers:          openai
          Model:              gpt-5-mini
    `),
    );
  });

  test("renders /usage transcript output with usage data", async () => {
    const session = createSession({
      id: "sess_tokens",
      tokenUsage: [
        {
          id: "row_1",
          usage: { inputTokens: 26100, outputTokens: 3900, totalTokens: 30000 },
          promptBreakdown: {
            budgetTokens: 26100,
            usedTokens: 26100,
            systemTokens: 9600,
            toolTokens: 12800,
            skillTokens: 0,
            memoryTokens: 0,
            messageTokens: 1300,
          },
        },
        {
          id: "row_2",
          usage: { inputTokens: 15900, outputTokens: 2700, totalTokens: 18600 },
          promptBreakdown: {
            budgetTokens: 15900,
            usedTokens: 15900,
            systemTokens: 6200,
            toolTokens: 8900,
            skillTokens: 0,
            memoryTokens: 0,
            messageTokens: 300,
          },
        },
      ],
    });
    const sessionState = createSessionState({ activeSessionId: session.id, sessions: [session] });
    const { handleMessage, allRows } = createMessageHandlerHarness({
      session,
      sessionState,
      tokenUsage: session.tokenUsage,
    });

    await handleMessage("/usage");

    expect(renderTranscript(allRows)).toBe(
      dedent(`
        ❯ /usage

          Usage

          Input:              15.9k  42.0k
          Output:             2.7k   6.6k
          Total:              18.6k  48.6k

          System:             6.2k  39%
          Tools:              8.9k  56%
          Skills:             0     0%
          Memory:             0     0%
          Messages:           300   2%
    `),
    );
  });

  test("renders /sessions transcript output with multiple sessions", async () => {
    const realNow = Date.now;
    Date.now = () => new Date("2026-03-02T00:00:00.000Z").getTime();
    const sessionState = createSessionState({
      activeSessionId: "sess_active",
      sessions: [
        createSession({ id: "sess_active", title: "Current Session", updatedAt: "2026-03-02T00:00:00.000Z" }),
        createSession({ id: "sess_prev", title: "Previous Session", updatedAt: "2026-03-02T00:00:00.000Z" }),
      ],
    });
    try {
      const { handleMessage, allRows } = createMessageHandlerHarness({ sessionState });

      await handleMessage("/sessions");

      expect(renderTranscript(allRows)).toBe(
        dedent(`
          ❯ /sessions

            Sessions 2

            ● sess_active  Current Session   just now
              sess_prev    Previous Session  just now
      `),
      );
    } finally {
      Date.now = realNow;
    }
  });
});
