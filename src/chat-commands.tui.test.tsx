import { describe, expect, test } from "bun:test";
import React from "react";
import { ChatTranscript } from "./chat-transcript";
import { createClient, createSession, createStore, createSubmitHandlerHarness, dedent } from "./test-factory";
import { renderInkPlain } from "./test-tui";

function renderTranscript(rows: Parameters<typeof ChatTranscript>[0]["rows"], columns = 96): string {
  return renderInkPlain(<ChatTranscript rows={rows} isWorking={false} thinkingFrame={0} />, columns);
}

describe("chat slash command visual regression", () => {
  test("renders /status transcript output", async () => {
    const { submit, rows } = createSubmitHandlerHarness({
      client: createClient({
        status: async () => ({
          provider: "openai",
          model: "gpt-5-mini",
          permissions: "write",
        }),
      }),
    });

    await submit("/status");

    expect(renderTranscript(rows)).toBe(dedent(`
      ❯ /status
      
        provider:           openai
        model:              gpt-5-mini
        permissions:        write
    `));
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
    const { submit, rows } = createSubmitHandlerHarness({
      session,
      store,
      tokenUsage: session.tokenUsage,
    });

    await submit("/tokens");

    expect(renderTranscript(rows)).toBe(dedent(`
      ❯ /tokens
      
        last_turn:           prompt=40 completion=10 total=50
        session:             prompt=160 completion=40 total=200 (2 turns)
        model_calls:         last=1 session=3
    `));
  });

  test("renders /sessions transcript output with multiple sessions", async () => {
    const store = createStore({
      activeSessionId: "sess_active",
      sessions: [
        createSession({ id: "sess_active", title: "Current Session" }),
        createSession({ id: "sess_prev", title: "Previous Session" }),
      ],
    });
    const { submit, rows } = createSubmitHandlerHarness({ store });

    await submit("/sessions");

    const rendered = renderTranscript(rows).replace(/(?:in moments|just now|\d+[smhdw] ago)/g, "<relative>");

    expect(rendered).toBe(dedent(`
      ❯ /sessions
      
        Sessions 2
      
        ● sess_active  Current Session   <relative>
          sess_prev    Previous Session  <relative>
    `));
  });
});
