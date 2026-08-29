import { afterEach, describe, expect, jest, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import { isToolOutput } from "./chat-contract";
import { createMessageStreamState } from "./chat-message-handler-stream";
import type { TranscriptRow } from "./chat-transcript-contract";
import { OUTPUT_WINDOW_ROWS, REVEAL_FRAME_MS } from "./tool-policy";

// Larger than any drip horizon, so advancing by it fully reveals the backlog.
const DRAIN_ALL_MS = 8000;
// A mutation reveals one row per paint. Nothing else is paced at all.
const MUTATION_ROW_MS = REVEAL_FRAME_MS;

function createRowsHarness(): {
  rows: ChatRow[];
  setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
} {
  const rows: ChatRow[] = [];
  const setRows = (updater: (current: ChatRow[]) => ChatRow[]): void => {
    rows.splice(0, rows.length, ...updater(rows));
  };
  return { rows, setRows };
}

describe("chat-message-handler-stream", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("accumulates agent deltas and exposes via streamedText", () => {
    const { setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onDelta("hello");
    state.onDelta(" world");
    expect(state.streamedText()).toBe("hello world");
    state.dispose();
  });

  test("onEvent routes row events to the same projection as the direct methods", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onEvent({ type: "text-delta", text: "answer" });
    expect(state.streamedText()).toBe("answer");

    state.onEvent({ type: "notice", level: "warn", message: "sink is dark" });
    expect(rows.some((r) => r.content === "sink is dark" && r.style?.outcome === "warning")).toBe(true);

    state.onEvent({ type: "error", errorMessage: "boom" });
    expect(rows.some((r) => r.content === "boom" && r.style?.outcome === "error")).toBe(true);
    state.dispose();
  });

  test("onEvent ignores non-row events (status/usage/reasoning)", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onEvent({ type: "status", state: { kind: "running" } });
    state.onEvent({ type: "usage", inputTokens: 10, outputTokens: 2 });
    state.onEvent({ type: "reasoning", text: "thinking" });
    expect(rows).toHaveLength(0);
    expect(state.streamedText()).toBe("");
    state.dispose();
  });

  test("finalize seals the streamed row and clears buffered state", async () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onDelta("hello");
    await new Promise((resolve) => setTimeout(resolve, 60));
    // A word is never shown half-written, so the last one waits for the end of its block.
    state.onTextEnd();
    expect(rows).toHaveLength(1);
    state.finalize();
    expect(rows).toHaveLength(1);
    expect(state.streamedText()).toBe("");
    state.dispose();
  });

  // Cutting a reveal by character count shows a word half-written and completes it on the next
  // frame, which is what reads as machine-made. Every reveal lands on a word boundary instead.
  test("prose is revealed by whole words", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    const source = "Streaming revealed one whole word at a time, never a fragment of one.";
    state.onDelta(`${source} `);
    const seen: string[] = [];
    for (let frame = 0; frame < 12; frame++) {
      jest.advanceTimersByTime(32);
      const content = rows[0]?.content;
      if (typeof content === "string" && content.length > 0 && !seen.includes(content)) seen.push(content);
    }

    expect(seen.length).toBeGreaterThan(2);
    // Every reveal is a prefix of the source that stops where a word does: the character it stopped
    // before is whitespace, or it stopped at the end.
    for (const text of seen) {
      const shown = text.trimEnd();
      expect(source.startsWith(shown)).toBe(true);
      const nextChar = source[shown.length];
      expect(nextChar === undefined || /\s/.test(nextChar)).toBe(true);
    }
    state.dispose();
  });

  // An emoji is several code points and one grapheme. Cutting by code point splits it, flashing a
  // dangling joiner or a lone person for a frame.
  test("an emoji built from several code points is never split", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const source = `ab ${family} cd ${family} ef gh ij kl mn op`;

    state.onDelta(`${source} `);
    const seen: string[] = [];
    for (let frame = 0; frame < 20; frame++) {
      jest.advanceTimersByTime(32);
      const content = rows[0]?.content;
      if (typeof content === "string" && content.length > 0 && !seen.includes(content)) seen.push(content);
    }

    expect(seen.length).toBeGreaterThan(1);
    for (const text of seen) {
      expect(text.endsWith("\u200D")).toBe(false);
      expect(/\u{1F468}$|\u{1F469}$/u.test(text) && source.slice(text.length).startsWith("\u200D")).toBe(false);
    }
    state.dispose();
  });

  // A run with no boundary in reach is not a word waiting to finish — a base64 blob or a long path
  // would hold the whole reveal hostage — so it is cut where it falls rather than held.
  test("a run too long to be a word is revealed without waiting for a boundary", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onDelta(`${"z".repeat(64)} tail`);
    jest.advanceTimersByTime(32);

    const shown = typeof rows[0]?.content === "string" ? rows[0].content : "";
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(64);
    expect(shown).toBe("z".repeat(shown.length));
    state.dispose();
  });

  // A word arriving in two deltas is still one word. Cutting at the delta boundary shows its first
  // half for a frame, which is the fragment the whole-word rule exists to prevent.
  test("a word split across deltas is never shown half-written", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onDelta("internatio");
    jest.advanceTimersByTime(32);
    expect(rows[0]?.content ?? "").toBe("");

    state.onDelta("nalization is long. ");
    jest.advanceTimersByTime(32 * 8);
    const shown = typeof rows[0]?.content === "string" ? rows[0].content : "";
    expect(shown.startsWith("internationalization")).toBe(true);
    state.dispose();
  });

  test("accumulates tool output with single header", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-search",
      content: {
        kind: "scope-header",
        labelKey: "tool.label.file_search",
        scope: "workspace",
        patterns: ["needle"],
        matches: 2,
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("tool");
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(1);

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-search",
      content: { kind: "text", text: "a.ts [needle@1]" },
    });
    // A mutation's rows after the first are revealed on the drip tick, not on arrival.
    jest.advanceTimersByTime(DRAIN_ALL_MS);
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(2);
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts[1]).toEqual({
      kind: "text",
      text: "a.ts [needle@1]",
    });
    state.dispose();
  });

  // A tool computes its output whole and sends it in one burst. The row reveals it a line at a
  // time so the reader watches the result appear, which is presentation only: the same parts, in
  // the same order, all of them present once the reveal finishes.
  test("a tool's output is revealed a line at a time, not all at once", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });
    const parts = (): number => (isToolOutput(rows[0]?.content) ? rows[0].content.parts.length : 0);

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-create",
      content: { kind: "edit-header", labelKey: "tool.label.file_create", path: "a.ts", added: 12, removed: 0 },
    });
    for (let line = 1; line <= 12; line++) {
      state.onOutput({
        toolCallId: "call_1",
        toolName: "file-create",
        content: { kind: "diff", marker: "add", lineNumber: line, text: `const value${line} = ${line};` },
      });
    }
    // The header placed the row; nothing else has been revealed yet.
    expect(parts()).toBe(1);

    // One row per paint, whatever the size of the backlog behind it.
    jest.advanceTimersByTime(MUTATION_ROW_MS);
    expect(parts()).toBe(2);
    jest.advanceTimersByTime(MUTATION_ROW_MS);
    expect(parts()).toBe(3);

    jest.advanceTimersByTime(DRAIN_ALL_MS);
    expect(parts()).toBe(13);
    state.dispose();
  });

  // Only a mutation is paced. A command's rows already appeared as the process printed them, and
  // every other tool knows its output in full when it returns — pacing either invents an arrival
  // and makes the reader wait for a tick they never asked for.
  test("a command's rows render on arrival, not on a tick", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });
    const parts = (): number => (isToolOutput(rows[0]?.content) ? rows[0].content.parts.length : 0);

    state.onOutput({
      toolCallId: "call_1",
      toolName: "shell-run",
      content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "bun test" },
    });
    for (const text of ["one", "two", "three"]) {
      state.onOutput({
        toolCallId: "call_1",
        toolName: "shell-run",
        content: { kind: "shell-output", stream: "stdout", text },
      });
    }
    // No timer has advanced. A paced call would still be showing its header alone.
    expect(parts()).toBe(4);
    state.dispose();
  });

  // A row carries its outcome while output is still arriving, but promoting it into scrollback
  // would freeze it without the rows it has not shown — so the hold keeps it back until the reveal
  // is done. A promoted row missing lines is transcript corruption.
  test("a settled tool row is held until its output is on screen", () => {
    jest.useFakeTimers();
    const { setRows } = createRowsHarness();
    const presentation: TranscriptRow[] = [];
    let held: ReadonlySet<string> = new Set();
    const state = createMessageStreamState({
      setRows,
      setTranscriptPresentation: (updater) => {
        presentation.splice(0, presentation.length, ...updater(presentation));
      },
      setHeldRowIds: (updater) => {
        held = updater(held);
      },
      surface: "transcript",
    });

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-edit",
      content: { kind: "edit-header", labelKey: "tool.label.file_edit", path: "a.ts", added: 6, removed: 6 },
    });
    for (let line = 1; line <= 12; line++) {
      state.onOutput({
        toolCallId: "call_1",
        toolName: "file-edit",
        content: { kind: "diff", marker: "add", lineNumber: line, text: `line ${line}` },
      });
    }
    state.onToolResult({ toolCallId: "call_1", toolName: "file-edit" });
    const rowId = presentation[0]?.id ?? "";
    expect(presentation[0]?.status).toBe("success");
    expect(held.has(rowId)).toBe(true);

    jest.advanceTimersByTime(DRAIN_ALL_MS);
    expect(held.has(rowId)).toBe(false);
    // Released, not trimmed: what the row revealed is what it keeps.
    expect(presentation[0]?.content.kind === "tool-output" && presentation[0].content.output.parts).toHaveLength(13);
    state.dispose();
  });

  // An interrupted call never returns a result, and a row left live front-anchors promotion: every
  // row after it is repainted forever instead of entering scrollback.
  test("a call left without a result is marked cancelled when the turn ends", () => {
    jest.useFakeTimers();
    const { setRows } = createRowsHarness();
    const presentation: TranscriptRow[] = [];
    const state = createMessageStreamState({
      setRows,
      setTranscriptPresentation: (updater) => {
        presentation.splice(0, presentation.length, ...updater(presentation));
      },
      surface: "transcript",
    });

    state.onOutput({
      toolCallId: "call_1",
      toolName: "shell",
      content: { kind: "tool-header", labelKey: "tool.label.shell" },
    });
    jest.advanceTimersByTime(DRAIN_ALL_MS);
    expect(presentation[0]?.status).toBe("active");

    state.finalize();
    expect(presentation[0]?.status).toBe("cancelled");
    state.dispose();
  });

  // The pace is the same whatever the result's size: a large diff takes longer, it does not switch
  // to arriving in batches.
  test("a large result keeps the same one-row pace", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });
    const parts = (): number => (isToolOutput(rows[0]?.content) ? rows[0].content.parts.length : 0);
    const contentRows = (): number =>
      isToolOutput(rows[0]?.content)
        ? rows[0].content.parts.filter((part) => part.kind !== "truncated" && part.kind !== "edit-header").length
        : 0;

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-create",
      content: { kind: "edit-header", labelKey: "tool.label.file_create", path: "a.ts", added: 40, removed: 0 },
    });
    for (let line = 1; line <= 40; line++) {
      state.onOutput({
        toolCallId: "call_1",
        toolName: "file-create",
        content: { kind: "diff", marker: "add", lineNumber: line, text: `line ${line}` },
      });
    }

    jest.advanceTimersByTime(MUTATION_ROW_MS * 5);
    expect(parts()).toBe(6);
    jest.advanceTimersByTime(MUTATION_ROW_MS * 35);
    expect(contentRows()).toBe(40);
    expect(parts()).toBe(41);
    state.dispose();
  });

  test("a revealing command never grows past its window", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });
    const contentRows = (): number =>
      isToolOutput(rows[0]?.content)
        ? rows[0].content.parts.filter((part) => part.kind !== "truncated" && part.kind !== "tool-header").length
        : 0;

    state.onOutput({
      toolCallId: "call_1",
      toolName: "shell-run",
      content: { kind: "tool-header", labelKey: "tool.label.shell_run" },
    });
    for (let line = 1; line <= 40; line++) {
      state.onOutput({
        toolCallId: "call_1",
        toolName: "shell-run",
        content: { kind: "shell-output", stream: "stdout", text: `line ${line}` },
      });
      jest.advanceTimersByTime(MUTATION_ROW_MS);
      expect(contentRows()).toBeLessThanOrEqual(OUTPUT_WINDOW_ROWS);
    }
    state.dispose();
  });

  // A diff is the record of a change the workspace no longer holds, so nothing trims it.
  test("a revealing diff grows past the command window", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });
    const contentRows = (): number =>
      isToolOutput(rows[0]?.content)
        ? rows[0].content.parts.filter((part) => part.kind !== "truncated" && part.kind !== "edit-header").length
        : 0;

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-edit",
      content: { kind: "edit-header", labelKey: "tool.label.file_edit", path: "a.ts", added: 20, removed: 20 },
    });
    for (let line = 1; line <= 40; line++) {
      state.onOutput({
        toolCallId: "call_1",
        toolName: "file-edit",
        content: { kind: "diff", marker: "add", lineNumber: line, text: `line ${line}` },
      });
      jest.advanceTimersByTime(MUTATION_ROW_MS);
    }
    expect(contentRows()).toBe(40);
    state.dispose();
  });

  test("ending the turn reveals whatever is still queued", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });
    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-create",
      content: { kind: "edit-header", labelKey: "tool.label.file_create", path: "a.ts", added: 3, removed: 0 },
    });
    for (let line = 1; line <= 3; line++) {
      state.onOutput({
        toolCallId: "call_1",
        toolName: "file-create",
        content: { kind: "diff", marker: "add", lineNumber: line, text: `line ${line}` },
      });
    }
    state.finalize();
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(4);
    state.dispose();
  });

  // Prose opening a row below a still-revealing tool row would be pushed down as that row grows,
  // so the reveal finishes first and the prose lands under the whole output.
  test("prose arriving mid-reveal reveals the rest of the output first", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-create",
      content: { kind: "edit-header", labelKey: "tool.label.file_create", path: "a.ts", added: 12, removed: 0 },
    });
    for (let line = 1; line <= 12; line++) {
      state.onOutput({
        toolCallId: "call_1",
        toolName: "file-create",
        content: { kind: "diff", marker: "add", lineNumber: line, text: `line ${line}` },
      });
    }
    jest.advanceTimersByTime(MUTATION_ROW_MS);
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(2);

    state.onDelta("and now some prose");
    jest.advanceTimersByTime(MUTATION_ROW_MS);

    // The prose waits: a diff's reveal is not cut short, so nothing opens under it yet.
    expect(rows[1]).toBeUndefined();

    jest.advanceTimersByTime(MUTATION_ROW_MS * 12);
    expect(rows[1]?.kind).toBe("assistant");
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(13);
    state.dispose();
  });

  // Ending the turn reveals what is still queued and takes nothing away, so the turn's last call
  // reads like any other.
  test("the turn's last call keeps what it revealed", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });
    const parts = (): number => (isToolOutput(rows[0]?.content) ? rows[0].content.parts.length : 0);

    state.onOutput({
      toolCallId: "call_1",
      toolName: "shell-run",
      content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "bun test" },
    });
    for (let line = 1; line <= OUTPUT_WINDOW_ROWS + 2; line++) {
      state.onOutput({
        toolCallId: "call_1",
        toolName: "shell-run",
        content: { kind: "shell-output", stream: "stdout", text: `line-${line}` },
      });
    }
    jest.advanceTimersByTime(MUTATION_ROW_MS * (OUTPUT_WINDOW_ROWS + 4));
    expect(parts()).toBe(OUTPUT_WINDOW_ROWS + 2);

    state.onToolResult({ toolCallId: "call_1", toolName: "shell-run" });
    state.finalize();
    expect(parts()).toBe(OUTPUT_WINDOW_ROWS + 2);
    state.dispose();
  });

  // A row opening after a call used to take that call's output back. Nothing does now: output that
  // has been shown is the record, and a later row must not be able to shrink it.
  test("a row opening after a call leaves its output alone", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });
    const parts = (id: number): number => (isToolOutput(rows[id]?.content) ? rows[id].content.parts.length : 0);
    const emit = (callId: string): void => {
      state.onOutput({
        toolCallId: callId,
        toolName: "shell-run",
        content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: callId },
      });
      for (let line = 1; line <= OUTPUT_WINDOW_ROWS + 2; line++) {
        state.onOutput({
          toolCallId: callId,
          toolName: "shell-run",
          content: { kind: "shell-output", stream: "stdout", text: `out ${callId} ${line}` },
        });
      }
    };

    emit("call_1");
    jest.advanceTimersByTime(MUTATION_ROW_MS * (OUTPUT_WINDOW_ROWS + 4));
    state.onToolResult({ toolCallId: "call_1", toolName: "shell-run" });
    expect(parts(0)).toBe(OUTPUT_WINDOW_ROWS + 2);

    emit("call_2");
    jest.advanceTimersByTime(MUTATION_ROW_MS * (OUTPUT_WINDOW_ROWS + 4));
    state.onToolResult({ toolCallId: "call_2", toolName: "shell-run", isError: true });
    jest.advanceTimersByTime(DRAIN_ALL_MS);

    expect(parts(0)).toBe(OUTPUT_WINDOW_ROWS + 2);
    expect(parts(1)).toBe(OUTPUT_WINDOW_ROWS + 2);
    state.dispose();
  });

  test("a tool's repeated line is kept, not folded into the one above it", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-edit",
      content: { kind: "edit-header", labelKey: "tool.label.file_edit", path: "a.ts", added: 1, removed: 0 },
    });
    state.onOutput({ toolCallId: "call_1", toolName: "file-edit", content: { kind: "text", text: "line A" } });
    state.onOutput({ toolCallId: "call_1", toolName: "file-edit", content: { kind: "text", text: "line A" } });
    jest.advanceTimersByTime(DRAIN_ALL_MS);
    expect(rows).toHaveLength(1);
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(3);
    state.dispose();
  });

  test("agent text row appears before tool row when text arrives first", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    // Agent emits text, then a tool call arrives — text should be flushed before the tool row.
    state.onDelta("Reading the file.");
    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-read",
      content: { kind: "tool-header", labelKey: "tool.label.file_read", detail: "src/a.ts" },
    });

    expect(rows.length).toBeGreaterThanOrEqual(2);
    const agentIndex = rows.findIndex((r) => r.kind === "assistant");
    const toolIndex = rows.findIndex((r) => r.kind === "tool");
    expect(agentIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThan(agentIndex);
    state.dispose();
  });

  test("finalize keeps streamed prose and tool rows committed", async () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onDelta("thinking...");
    await new Promise((resolve) => setTimeout(resolve, 60));
    state.onTextEnd();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("assistant");

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-read",
      content: { kind: "tool-header", labelKey: "tool.label.file_read", detail: "a.ts" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]?.kind).toBe("tool");

    state.onDelta("done now");
    await new Promise((resolve) => setTimeout(resolve, 60));
    state.onTextEnd();
    expect(rows).toHaveLength(3);

    state.finalize();
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.kind === "tool")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "assistant").map((r) => r.content)).toEqual(["thinking...", "done now"]);
    expect(state.streamedText()).toBe("");
    state.dispose();
  });

  test("onToolCall flushes pending text before tool output arrives", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onDelta("Let me read that.");
    expect(rows).toHaveLength(0); // not flushed yet (timer pending)

    state.onToolCall();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("assistant");
    expect(rows[0]?.content).toBe("Let me read that.");

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-read",
      content: { kind: "tool-header", labelKey: "tool.label.file_read", detail: "a.ts" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]?.kind).toBe("tool");
    state.dispose();
  });

  test("a text-block boundary is a paragraph break within one row", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onEvent({ type: "text-delta", text: "I'll answer the latest turn directly." });
    state.onEvent({ type: "text-end" });
    state.onEvent({ type: "text-delta", text: "Testing received." });
    state.onEvent({ type: "text-end" });
    state.finalize();

    expect(rows.filter((row) => row.kind === "assistant").map((row) => row.content)).toEqual([
      "I'll answer the latest turn directly.\n\nTesting received.",
    ]);
    state.dispose();
  });

  test("a tool call between blocks drops the owed paragraph break", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onEvent({ type: "text-delta", text: "Let me read that." });
    state.onEvent({ type: "text-end" });
    state.onToolCall();
    state.onEvent({ type: "text-delta", text: "It returns a scene." });
    state.finalize();

    expect(rows.filter((row) => row.kind === "assistant").map((row) => row.content)).toEqual([
      "Let me read that.",
      "It returns a scene.",
    ]);
    state.dispose();
  });

  test("a text-end before any prose opens no blank paragraph", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onEvent({ type: "text-end" });
    state.onEvent({ type: "text-delta", text: "Testing received." });
    state.finalize();

    expect(rows.filter((row) => row.kind === "assistant").map((row) => row.content)).toEqual(["Testing received."]);
    state.dispose();
  });

  test("leading newlines are stripped when creating new assistant row", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    // step-start emits "\n", then real text follows
    state.onDelta("\n");
    state.onDelta("Hello world");
    jest.advanceTimersByTime(DRAIN_ALL_MS);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("assistant");
    expect(rows[0]?.content).toBe("Hello world");
    state.dispose();
  });

  test("whitespace-only pending content does not create empty assistant row", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    // Simulate step-start emitting a newline before a tool call
    state.onDelta("\n");
    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-read",
      content: { kind: "tool-header", labelKey: "tool.label.file_read", detail: "a.ts" },
    });

    // Only the tool row should exist — no empty assistant row
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("tool");
    state.dispose();
  });

  test("removes budget-exhausted tool rows", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onOutput({
      toolCallId: "call_blocked",
      toolName: "shell-run",
      content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "echo hi" },
    });
    expect(rows).toHaveLength(1);

    state.onToolResult({
      toolCallId: "call_blocked",
      toolName: "shell-run",
      isError: true,
      errorCode: "E_GUARD_BLOCKED",
      error: { category: "budget-exhausted" },
    });
    expect(rows).toHaveLength(0);
    state.dispose();
  });

  // A result can beat its own first output part: the part waits behind a diff's reveal, while the
  // call it belongs to has already returned. The outcome must survive that wait.
  test("a result that arrives before its row settles the row once it opens", () => {
    jest.useFakeTimers();
    const { setRows } = createRowsHarness();
    const presentation: TranscriptRow[] = [];
    const state = createMessageStreamState({
      setRows,
      setTranscriptPresentation: (updater) => {
        presentation.splice(0, presentation.length, ...updater(presentation));
      },
      surface: "transcript",
    });

    state.onOutput({
      toolCallId: "call_diff",
      toolName: "file-create",
      content: { kind: "edit-header", labelKey: "tool.label.file_create", path: "a.ts", added: 6, removed: 0 },
    });
    for (let line = 1; line <= 6; line++) {
      state.onOutput({
        toolCallId: "call_diff",
        toolName: "file-create",
        content: { kind: "diff", marker: "add", lineNumber: line, text: `line ${line}` },
      });
    }
    state.onOutput({
      toolCallId: "call_read",
      toolName: "file-read",
      content: { kind: "tool-header", labelKey: "tool.label.file_read" },
    });
    state.onToolResult({ toolCallId: "call_read", toolName: "file-read" });

    jest.advanceTimersByTime(DRAIN_ALL_MS);
    state.finalize();
    const readRow = presentation.find((row) => row.content.kind === "tool-output" && row.id !== presentation[0]?.id);
    expect(readRow?.status).toBe("success");
    state.dispose();
  });

  // The part that would have opened the row is still waiting behind a reveal when the call is
  // blocked. Letting it through afterwards leaves a row for a call that has no result coming.
  test("a budget-exhausted call opens no row from output still waiting", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onOutput({
      toolCallId: "call_diff",
      toolName: "file-create",
      content: { kind: "edit-header", labelKey: "tool.label.file_create", path: "a.ts", added: 6, removed: 0 },
    });
    for (let line = 1; line <= 6; line++) {
      state.onOutput({
        toolCallId: "call_diff",
        toolName: "file-create",
        content: { kind: "diff", marker: "add", lineNumber: line, text: `line ${line}` },
      });
    }
    state.onOutput({
      toolCallId: "call_blocked",
      toolName: "shell-run",
      content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "echo hi" },
    });
    state.onToolResult({
      toolCallId: "call_blocked",
      toolName: "shell-run",
      isError: true,
      errorCode: "E_GUARD_BLOCKED",
      error: { category: "budget-exhausted" },
    });

    jest.advanceTimersByTime(DRAIN_ALL_MS);
    expect(rows).toHaveLength(1);
    state.dispose();
  });

  test("streamed text persists after finalize when status row is appended", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    // Simulate: tool calls, then text response, then finalize
    state.onToolCall();
    state.onOutput({
      toolCallId: "call_1",
      toolName: "memory-search",
      content: { kind: "tool-header", labelKey: "tool.label.memory_search" },
    });
    state.onToolResult({ toolCallId: "call_1", toolName: "memory-search" });

    state.onDelta("Tell me what to build.");
    jest.advanceTimersByTime(DRAIN_ALL_MS);
    expect(rows.some((r) => r.kind === "assistant" && r.content === "Tell me what to build.")).toBe(true);

    state.finalize();

    // Simulate message handler appending a status row after the turn
    setRows((current) => [...current, { id: "status_1", kind: "status", content: "Worked 3s" }]);

    // The streamed assistant text must still be present
    const assistantRow = rows.find((r) => r.kind === "assistant");
    expect(assistantRow).toBeDefined();
    expect(assistantRow?.content).toBe("Tell me what to build.");
  });

  // React 19 + StrictMode may invoke a setRows updater more than once, or defer
  // it past a closure reset. This harness models both: every queued updater is
  // invoked once with its result DISCARDED (the StrictMode extra call) and then
  // again for real. The stream state's updaters must be pure or the streamed
  // assistant row desyncs from its tracked id and silently vanishes.
  function createStrictHarness(): {
    rows: ChatRow[];
    setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
    render: () => void;
  } {
    const rows: ChatRow[] = [];
    const queue: Array<(current: ChatRow[]) => ChatRow[]> = [];
    const setRows = (updater: (current: ChatRow[]) => ChatRow[]): void => {
      queue.push(updater);
    };
    const render = (): void => {
      while (queue.length > 0) {
        const updater = queue.shift();
        if (!updater) continue;
        updater([...rows]); // StrictMode extra invocation — result discarded
        rows.splice(0, rows.length, ...updater(rows)); // real invocation — committed
      }
    };
    return { rows, setRows, render };
  }

  test("streamed answer survives StrictMode double-invocation of the flush updater", () => {
    jest.useFakeTimers();
    const h = createStrictHarness();
    const state = createMessageStreamState({ setRows: h.setRows, surface: "transcript" });
    state.onDelta("The final answer.");
    jest.advanceTimersByTime(DRAIN_ALL_MS); // ticks enqueue the updater
    state.onTextEnd(); // the block's last word lands with its end
    h.render();
    expect(h.rows.filter((r) => r.kind === "assistant").map((r) => r.content)).toEqual(["The final answer."]);
    state.dispose();
  });

  test("streamed content survives a flush deferred past finalize's closure reset", () => {
    const h = createStrictHarness();
    const state = createMessageStreamState({ setRows: h.setRows, surface: "transcript" });
    state.onDelta("Tail that must not vanish.");
    state.finalize(); // enqueues flush, then resets the closure — before render
    h.render();
    expect(h.rows.filter((r) => r.kind === "assistant").map((r) => r.content)).toEqual(["Tail that must not vanish."]);
    state.dispose();
  });

  test("onProgressNotice appends a warn-styled system row", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onProgressNotice({ message: "Trace logging is off.", level: "warn", source: "trace-store" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("system");
    expect(rows[0]?.content).toBe("Trace logging is off.");
    // warn is not the error outcome — a non-fatal notice must not read as a task failure.
    expect(rows[0]?.style?.outcome).toBe("warning");
    expect(rows[0]?.style?.outcome).not.toBe("error");
    state.dispose();
  });

  test("onProgressNotice deduplicates an identical consecutive notice", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    state.onProgressNotice({ message: "same", level: "warn" });
    state.onProgressNotice({ message: "same", level: "warn" });
    expect(rows).toHaveLength(1);
    state.dispose();
  });

  test("drips a burst incrementally instead of publishing it in one jump", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    // A whole paragraph arrives at once, as a rate-limited provider flushes a buffered burst.
    const burst = `${"word ".repeat(40)}end`;
    state.onDelta(burst);

    // A couple of ticks in — well under the drain horizon — only part is revealed.
    jest.advanceTimersByTime(64);
    const partial = typeof rows[0]?.content === "string" ? rows[0].content : "";
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(burst.length);

    // Draining reveals the rest, intact and in order.
    jest.advanceTimersByTime(DRAIN_ALL_MS);
    state.onTextEnd();
    expect(rows[0]?.content).toBe(burst);
    state.dispose();
  });

  test("a tool call mid-drip flushes the full backlog before the tool row", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows, surface: "transcript" });

    const prose = "Reading the file to understand the failure before editing.";
    state.onDelta(prose);
    jest.advanceTimersByTime(64); // only a fragment has dripped in

    // The tool call must drain the remaining backlog into the prose row, ordered before the
    // tool row, with nothing dropped — the onOutput inline-seal bypass would otherwise lose it.
    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-read",
      content: { kind: "tool-header", labelKey: "tool.label.file_read", detail: "a.ts" },
    });

    const assistantIdx = rows.findIndex((r) => r.kind === "assistant");
    const toolIdx = rows.findIndex((r) => r.kind === "tool");
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThan(assistantIdx);
    expect(rows[assistantIdx]?.content).toBe(prose);
    state.dispose();
  });
});

describe("chat-message-handler-stream: presentation stays in sync on prune", () => {
  function createDualHarness(): {
    rows: ChatRow[];
    presentation: TranscriptRow[];
    setRows: (updater: (current: ChatRow[]) => ChatRow[]) => void;
    setTranscriptPresentation: (updater: (current: TranscriptRow[]) => TranscriptRow[]) => void;
  } {
    const rows: ChatRow[] = [];
    const presentation: TranscriptRow[] = [];
    return {
      rows,
      presentation,
      setRows: (updater) => rows.splice(0, rows.length, ...updater(rows)),
      setTranscriptPresentation: (updater) => presentation.splice(0, presentation.length, ...updater(presentation)),
    };
  }

  const tasklist = {
    groupId: "g1",
    groupTitle: "Plan",
    items: [{ id: "i1", label: "step one", status: "in_progress" as const, order: 0 }],
  };

  // Regression: persistence is presentation-first, so a row pruned from `rows` but left in
  // `transcriptPresentation` reappears on resume. finalize/dispose must prune both.
  test("finalize removes the tasklist from rows AND presentation", () => {
    const harness = createDualHarness();
    const state = createMessageStreamState({ ...harness, surface: "transcript" });
    state.onTasklist(tasklist);
    expect(harness.rows).toHaveLength(1);
    expect(harness.presentation).toHaveLength(1);

    state.finalize();
    expect(harness.rows).toHaveLength(0);
    expect(harness.presentation).toHaveLength(0);
  });

  test("dispose removes the tasklist from rows AND presentation", () => {
    const harness = createDualHarness();
    const state = createMessageStreamState({ ...harness, surface: "transcript" });
    state.onTasklist(tasklist);
    expect(harness.presentation).toHaveLength(1);

    state.dispose();
    expect(harness.rows).toHaveLength(0);
    expect(harness.presentation).toHaveLength(0);
  });

  test("tool output seals preceding assistant prose in the presentation", () => {
    const harness = createDualHarness();
    const state = createMessageStreamState({ ...harness, surface: "transcript" });
    state.onDelta("Reading the file first.");
    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-read",
      content: { kind: "tool-header", labelKey: "tool.label.file_read", detail: "a.ts" },
    });

    expect(harness.presentation).toMatchObject([
      { kind: "assistant", status: "complete", content: { kind: "message", text: "Reading the file first." } },
      { kind: "tool", status: "active" },
    ]);
    state.dispose();
  });
});

describe("effect rows", () => {
  function transcriptHarness() {
    const rows: ChatRow[] = [];
    const transcript: TranscriptRow[] = [];
    const state = createMessageStreamState({
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setTranscriptPresentation: (updater) => {
        transcript.splice(0, transcript.length, ...updater(transcript));
      },
      surface: "transcript",
    });
    return { rows, transcript, state };
  }

  test("an effect row is finished on arrival, with no tool result to close it", () => {
    const { transcript, state } = transcriptHarness();

    state.onEffect({
      effect: "format",
      command: "biome check --write a.ts",
      output: [{ kind: "shell-output", stream: "stderr", text: "Fixed 1 file." }],
    });

    expect(transcript).toHaveLength(1);
    expect(transcript[0]?.status).toBe("complete");

    // A row left active front-anchors promotion for the rest of the session, so finalize() must
    // find nothing to cancel here.
    state.finalize();
    expect(transcript[0]?.status).toBe("complete");
    state.dispose();
  });

  test("an ordinary tool row still waits for its result", () => {
    const { transcript, state } = transcriptHarness();

    state.onOutput({
      toolCallId: "call_1",
      toolName: "shell-run",
      content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "bun test" },
    });

    expect(transcript[0]?.status).toBe("active");
    state.onToolResult({ toolCallId: "call_1", toolName: "shell-run" });
    expect(transcript[0]?.status).toBe("success");
    state.dispose();
  });
});
