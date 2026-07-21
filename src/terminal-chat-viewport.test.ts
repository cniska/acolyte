import { expect, test } from "bun:test";
import { layoutChatViewport } from "./terminal-chat-layout";
import { terminalTheme } from "./terminal-theme";

test("viewport layout orders finalized transcript before mutable pending and composer sections", () => {
  const scene = layoutChatViewport({
    presentation: {
      header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
      transcript: [
        { id: "row_1", kind: "assistant", lifecycle: "complete", content: { kind: "message", text: "hello" } },
      ],
      pending: { state: { kind: "running" }, frame: 0, startedAt: 0, queuedMessages: [], runningUsage: null },
      composer: {
        input: { text: "ask", cursor: 3 },
        placeholder: "Ask",
        picker: null,
        suggestions: [],
        showHelp: false,
        status: null,
      },
      sections: [],
    },
    constraints: { columns: 40, rows: 20 },
    theme: terminalTheme,
    now: 0,
  });
  expect(scene.sections?.map((section) => [section.id, section.finalized])).toEqual([
    ["header", true],
    ["row_1", true],
    ["pending", false],
    ["composer", false],
  ]);
  expect(scene.cursor?.row).toBeGreaterThan(0);
});
