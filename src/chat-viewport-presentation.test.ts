import { expect, test } from "bun:test";
import { createChatViewportPresentation } from "./chat-viewport-presentation";

test("viewport presentation preserves active transcript and derives scene composer inputs", () => {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript: [
      { id: "row_1", kind: "assistant", status: "complete", content: { kind: "message", text: "hello" } },
    ],
    pending: null,
    composer: {
      input: { text: "/st", cursor: 3 },
      picker: {
        kind: "model",
        input: { text: "gpt", cursor: 1 },
        items: [{ label: "GPT", value: "openai/gpt" }],
        selected: 0,
        scrollOffset: 0,
        loading: false,
      },
      suggestions: { kind: "slash", candidates: ["/status"], selected: 0 },
      help: { visible: false, entries: [] },
      ctrlCPending: false,
      footer: {
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
      },
    },
  });
  expect(presentation.transcript.map((row) => row.id)).toEqual(["row_1"]);
  expect(presentation.footer?.model).toBe("gpt-5");
  expect(presentation.composer.picker).toMatchObject({ kind: "model", input: { text: "gpt", cursor: 1 } });
  expect(presentation.composer.suggestions).toMatchObject({
    kind: "slash",
    candidates: [{ command: "/status", help: "show server status" }],
  });
});
