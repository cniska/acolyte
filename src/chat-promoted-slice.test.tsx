import { expect, test } from "bun:test";
import { PromotedSliceView } from "./chat-promoted-slice";
import type { TranscriptRow } from "./chat-transcript-contract";
import { createChatViewportPresentation } from "./chat-viewport-presentation";
import { layoutChatViewport } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { terminalTheme } from "./terminal-theme";
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

const columns = 60;

function sceneFor(activeTranscript: TranscriptRow[]) {
  const presentation = createChatViewportPresentation({
    header: { title: "Acolyte", version: "1", sessionId: "sess_1" },
    activeTranscript,
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
  return layoutChatViewport({ presentation, constraints: { columns, rows: 60 }, theme: terminalTheme, now: 0 });
}

// A promoted slice must render byte-for-byte the same as it did in the live frame it was
// frozen from: the live tail carries the scene's inter-section separator (an empty line)
// before each section, so PromotedSliceView's leading blank must serialize identically.
test("a promoted slice renders identically to its live-frame lines", () => {
  const scene = sceneFor([
    { id: "r1", kind: "user", status: "complete", content: { kind: "message", text: "inspect the changes" } },
    { id: "r2", kind: "assistant", status: "complete", content: { kind: "message", text: "here is what I found" } },
  ]);
  for (const id of ["r2"]) {
    const section = scene.sections?.find((candidate) => candidate.id === id);
    if (!section) throw new Error(`missing section ${id}`);
    const sliceLines = scene.lines.slice(section.lineStart, section.lineEnd);
    // The separator the live frame renders before this section (the blank line the slice's
    // own range excludes).
    const liveLines = scene.lines.slice(section.lineStart - 1, section.lineEnd);
    const live = renderPlain(<TerminalSceneRender scene={{ lines: liveLines }} />, columns);
    const promoted = renderPlain(<PromotedSliceView slice={{ id, lines: sliceLines }} />, columns);
    expect(promoted).toBe(live);
  }
});
