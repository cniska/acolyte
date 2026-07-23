import { afterEach, describe, expect, jest, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import { isToolOutput } from "./chat-contract";
import { createMessageStreamState } from "./chat-message-handler-stream";
import type { TranscriptRow } from "./chat-transcript-contract";

// Larger than any drip horizon, so advancing by it fully reveals the backlog.
const DRAIN_ALL_MS = 1000;

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
    const state = createMessageStreamState({ setRows });

    state.onDelta("hello");
    state.onDelta(" world");
    expect(state.streamedText()).toBe("hello world");
    state.dispose();
  });

  test("onEvent routes row events to the same projection as the direct methods", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

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
    const state = createMessageStreamState({ setRows });

    state.onEvent({ type: "status", state: { kind: "running" } });
    state.onEvent({ type: "usage", inputTokens: 10, outputTokens: 2 });
    state.onEvent({ type: "reasoning", text: "thinking" });
    expect(rows).toHaveLength(0);
    expect(state.streamedText()).toBe("");
    state.dispose();
  });

  test("finalize seals the streamed row and clears buffered state", async () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onDelta("hello");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(rows).toHaveLength(1);
    state.finalize();
    expect(rows).toHaveLength(1);
    expect(state.streamedText()).toBe("");
    state.dispose();
  });

  test("accumulates tool output with single header", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

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
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(2);
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts[1]).toEqual({
      kind: "text",
      text: "a.ts [needle@1]",
    });
    state.dispose();
  });

  test("deduplicates identical output items", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    state.onOutput({
      toolCallId: "call_1",
      toolName: "file-edit",
      content: { kind: "edit-header", labelKey: "tool.label.file_edit", path: "a.ts", added: 1, removed: 0 },
    });
    state.onOutput({ toolCallId: "call_1", toolName: "file-edit", content: { kind: "text", text: "line A" } });
    state.onOutput({ toolCallId: "call_1", toolName: "file-edit", content: { kind: "text", text: "line A" } });
    expect(rows).toHaveLength(1);
    expect(isToolOutput(rows[0]?.content) && rows[0].content.parts).toHaveLength(2);
    state.dispose();
  });

  test("agent text row appears before tool row when text arrives first", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

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
    const state = createMessageStreamState({ setRows });

    state.onDelta("thinking...");
    await new Promise((resolve) => setTimeout(resolve, 60));
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
    const state = createMessageStreamState({ setRows });

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

  test("leading newlines are stripped when creating new assistant row", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

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
    const state = createMessageStreamState({ setRows });

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
    const state = createMessageStreamState({ setRows });

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

  test("streamed text persists after finalize when status row is appended", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

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
    const state = createMessageStreamState({ setRows: h.setRows });
    state.onDelta("The final answer.");
    jest.advanceTimersByTime(DRAIN_ALL_MS); // ticks enqueue the updater
    h.render();
    expect(h.rows.filter((r) => r.kind === "assistant").map((r) => r.content)).toEqual(["The final answer."]);
    state.dispose();
  });

  test("streamed content survives a flush deferred past finalize's closure reset", () => {
    const h = createStrictHarness();
    const state = createMessageStreamState({ setRows: h.setRows });
    state.onDelta("Tail that must not vanish.");
    state.finalize(); // enqueues flush, then resets the closure — before render
    h.render();
    expect(h.rows.filter((r) => r.kind === "assistant").map((r) => r.content)).toEqual(["Tail that must not vanish."]);
    state.dispose();
  });

  test("onProgressNotice appends a warn-styled system row", () => {
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

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
    const state = createMessageStreamState({ setRows });

    state.onProgressNotice({ message: "same", level: "warn" });
    state.onProgressNotice({ message: "same", level: "warn" });
    expect(rows).toHaveLength(1);
    state.dispose();
  });

  test("drips a burst incrementally instead of publishing it in one jump", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

    // A whole paragraph arrives at once, as a rate-limited provider flushes a buffered burst.
    const burst = "x".repeat(200);
    state.onDelta(burst);

    // A couple of ticks in — well under the drain horizon — only part is revealed.
    jest.advanceTimersByTime(64);
    const partial = typeof rows[0]?.content === "string" ? rows[0].content : "";
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(burst.length);

    // Draining reveals the rest, intact and in order.
    jest.advanceTimersByTime(DRAIN_ALL_MS);
    expect(rows[0]?.content).toBe(burst);
    state.dispose();
  });

  test("a tool call mid-drip flushes the full backlog before the tool row", () => {
    jest.useFakeTimers();
    const { rows, setRows } = createRowsHarness();
    const state = createMessageStreamState({ setRows });

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

  const checklist = {
    groupId: "g1",
    groupTitle: "Plan",
    items: [{ id: "i1", label: "step one", status: "in_progress" as const, order: 0 }],
  };

  // Regression: persistence is presentation-first, so a row pruned from `rows` but left in
  // `transcriptPresentation` reappears on resume. finalize/dispose must prune both.
  test("finalize removes the checklist from rows AND presentation", () => {
    const harness = createDualHarness();
    const state = createMessageStreamState(harness);
    state.onChecklist(checklist);
    expect(harness.rows).toHaveLength(1);
    expect(harness.presentation).toHaveLength(1);

    state.finalize();
    expect(harness.rows).toHaveLength(0);
    expect(harness.presentation).toHaveLength(0);
  });

  test("dispose removes the checklist from rows AND presentation", () => {
    const harness = createDualHarness();
    const state = createMessageStreamState(harness);
    state.onChecklist(checklist);
    expect(harness.presentation).toHaveLength(1);

    state.dispose();
    expect(harness.rows).toHaveLength(0);
    expect(harness.presentation).toHaveLength(0);
  });
});
