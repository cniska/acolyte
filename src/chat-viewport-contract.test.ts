import { expect, test } from "bun:test";
import { chatViewportPresentationSchema } from "./chat-viewport-contract";
import { finalizeScene } from "./terminal-scene-contract";

test("viewport contracts require semantic sections and renderer-independent composer state", () => {
  const parsed = chatViewportPresentationSchema.safeParse({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    transcript: [],
    pending: null,
    composer: {
      input: { text: "hello", cursor: 5 },
      placeholder: "Ask",
      picker: null,
      suggestions: [],
      showHelp: false,
      status: null,
    },
    sections: [{ id: "composer", kind: "composer", finalized: false }],
  });
  expect(parsed.success).toBe(true);
  expect(
    finalizeScene({ lines: [], sections: [{ id: "transcript", lineStart: 0, lineEnd: 0, finalized: true }] })
      .sections?.[0]?.finalized,
  ).toBe(true);
});
