import { describe, expect, test } from "bun:test";
import { ChatTranscript } from "./chat-transcript";
import { createClient, createMessageHandlerHarness, createSession, createStore, dedent } from "./test-utils";
import { renderPlain } from "./tui-test-utils";

function renderTranscript(rows: Parameters<typeof ChatTranscript>[0]["rows"], columns = 96): string {
  return dedent(renderPlain(<ChatTranscript rows={rows} isWorking={false} thinkingFrame={0} />, columns));
}

describe("chat slash command visual regression", () => {
  test("renders /status transcript output", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({
          providers: ["openai"],
          model: "gpt-5-mini",
          permissions: "write",
        }),
      }),
    });

    await handleMessage("/status");

    expect(renderTranscript(rows)).toBe(
      dedent(`
        providers:          openai
        model:              gpt-5-mini
        permissions:        write
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
            memoryTokens: 2400,
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
            memoryTokens: 500,
            messageTokens: 300,
          },
        },
      ],
    });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const { handleMessage, rows } = createMessageHandlerHarness({
      session,
      store,
      tokenUsage: session.tokenUsage,
    });

    await handleMessage("/usage");

    expect(renderTranscript(rows)).toBe(
      dedent(`
        Usage

                        Last turn     Session
        Input           16k           42k
        Output          2.7k          6.6k
        Total           19k           49k

                        Tokens        Share
        System          6.2k          39%
        Tools           8.9k          56%
        Memory          500           3%
        Messages        300           2%
    `),
    );
  });

  test("renders /sessions transcript output with multiple sessions", async () => {
    const realNow = Date.now;
    Date.now = () => new Date("2026-03-02T00:00:00.000Z").getTime();
    const store = createStore({
      activeSessionId: "sess_active",
      sessions: [
        createSession({ id: "sess_active", title: "Current Session", updatedAt: "2026-03-02T00:00:00.000Z" }),
        createSession({ id: "sess_prev", title: "Previous Session", updatedAt: "2026-03-02T00:00:00.000Z" }),
      ],
    });
    try {
      const { handleMessage, rows } = createMessageHandlerHarness({ store });

      await handleMessage("/sessions");

      expect(renderTranscript(rows)).toBe(
        dedent(`
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
