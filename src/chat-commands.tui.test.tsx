import { describe, expect, test } from "bun:test";
import { ChatTranscript } from "./chat-transcript";
import { createClient, createMessageHandlerHarness, createSession, createStore, dedent } from "./test-utils";
import { renderInkPlain } from "./tui-test-utils";

function renderTranscript(rows: Parameters<typeof ChatTranscript>[0]["rows"], columns = 96): string {
  return renderInkPlain(<ChatTranscript rows={rows} isWorking={false} thinkingFrame={0} />, columns);
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
      ❯ /status
      
        providers:          openai
        model:              gpt-5-mini
        permissions:        write
    `),
    );
  });

  test("renders /tokens transcript output with usage data", async () => {
    const session = createSession({
      id: "sess_tokens",
      tokenUsage: [
        {
          id: "row_1",
          usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
          modelCalls: 2,
        },
        {
          id: "row_2",
          usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50 },
          modelCalls: 1,
        },
      ],
    });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const { handleMessage, rows } = createMessageHandlerHarness({
      session,
      store,
      tokenUsage: session.tokenUsage,
    });

    await handleMessage("/tokens");

    expect(renderTranscript(rows)).toBe(
      dedent(`
      ❯ /tokens
      
        last_turn:           prompt=40 completion=10 total=50
        session:             prompt=160 completion=40 total=200 (2 turns)
        model_calls:         last=1 session=3
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
