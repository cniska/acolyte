import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import { migrateLegacyChatRow } from "./chat-transcript-contract";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { layoutChatViewport } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { terminalTheme } from "./terminal-theme";
import { createClient, createMessageHandlerHarness, createSession, createSessionState, dedent } from "./test-utils";
import { DEFAULT_TERMINAL_WIDTH } from "./tui/constants";
import { renderPlain } from "./tui/test-utils";

const footer = {
  repo: "acolyte",
  worktree: null,
  branch: "main",
  dirty: false,
  ahead: 0,
  behind: 0,
  model: "gpt-5",
  effort: null,
  inputTokens: 0,
  outputTokens: 0,
  pr: null,
  skills: [],
} as const;

// Drive the semantic transcript through the same scene pipeline the live chat uses,
// then read only the transcript region (between the header and the composer).
function renderTranscript(rows: ChatRow[], columns = DEFAULT_TERMINAL_WIDTH): string {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: rows.map(migrateLegacyChatRow),
    pending: null,
    composer: {
      input: { text: "", cursor: 0 },
      picker: null,
      suggestions: { kind: "none" },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer,
    },
  });
  const scene = layoutChatViewport({ presentation, constraints: { columns, rows: 200 }, theme: terminalTheme, now: 0 });
  const header = scene.sections?.find((section) => section.id === "header");
  const composer = scene.sections?.find((section) => section.id === "composer");
  const lines = scene.lines.slice(header?.lineEnd, composer?.lineStart);
  return dedent(renderPlain(<TerminalSceneRender scene={{ lines }} />, columns));
}

describe("chat slash command visual regression", () => {
  test("renders /status transcript output", async () => {
    const { handleMessage, allRows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({
          provider_auth: ["openai (api key)"],
          model: "gpt-5-mini",
        }),
      }),
    });

    await handleMessage("/status");

    expect(renderTranscript(allRows)).toBe(
      dedent(`
        ❯ /status


          Status

          Providers:          openai (api key)
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

            ◆ sess_active  Current Session   just now
              sess_prev    Previous Session  just now
      `),
      );
    } finally {
      Date.now = realNow;
    }
  });
});
