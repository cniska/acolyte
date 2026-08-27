import { afterEach, describe, expect, jest, test } from "bun:test";
import { createProcessOutput } from "./tool-live-output";
import { OUTPUT_WINDOW_ROWS, REVEAL_FRAME_MS } from "./tool-policy";

describe("createProcessOutput", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  function collect() {
    const rows: string[] = [];
    const output = createProcessOutput({
      toolName: "shell-run",
      toolCallId: "tc_1",
      onOutput: (event) => {
        if (event.content.kind === "shell-output") rows.push(event.content.text);
      },
    });
    return { output, rows };
  }

  // A process writes when its buffer fills, not when a line ends, so a line arrives in pieces.
  // Splitting each chunk on its own turns one line into several.
  test("a line split across chunks is one row", () => {
    const { output } = collect();
    output.chunk("stdout", "hello ");
    output.chunk("stdout", "world\n");
    expect(output.finish()).toEqual([{ stream: "stdout", text: "hello world" }]);
  });

  test("a final line with no trailing newline is kept", () => {
    const { output } = collect();
    output.chunk("stdout", "done");
    expect(output.finish()).toEqual([{ stream: "stdout", text: "done" }]);
  });

  test("streams are assembled independently", () => {
    const { output } = collect();
    output.chunk("stdout", "out-");
    output.chunk("stderr", "err-");
    output.chunk("stdout", "1\n");
    output.chunk("stderr", "2\n");
    expect(output.finish()).toEqual([
      { stream: "stdout", text: "out-1" },
      { stream: "stderr", text: "err-2" },
    ]);
  });

  test("blank lines are dropped", () => {
    const { output } = collect();
    output.chunk("stdout", "a\n\n\nb\n");
    expect(output.finish()).toEqual([
      { stream: "stdout", text: "a" },
      { stream: "stdout", text: "b" },
    ]);
  });

  // Live rows are batched behind a timer, so nothing is emitted on the chunk itself.
  test("lines are emitted as transient rows once the batch flushes", () => {
    jest.useFakeTimers();
    const rows: string[] = [];
    const transient: Array<boolean | undefined> = [];
    const output = createProcessOutput({
      toolName: "shell-run",
      toolCallId: "tc_1",
      onOutput: (event) => {
        if (event.content.kind !== "shell-output") return;
        rows.push(event.content.text);
        transient.push(event.transient);
      },
    });

    output.chunk("stdout", "first\nsecond\n");
    expect(rows).toEqual([]);

    jest.advanceTimersByTime(REVEAL_FRAME_MS);
    expect(rows).toEqual(["first", "second"]);
    expect(transient).toEqual([true, true]);
  });

  // Only the newest rows are ever on screen, so a burst larger than the window drops its head
  // instead of emitting rows that would be scrolled off within the same flush.
  test("a burst larger than the window emits only its newest rows", () => {
    jest.useFakeTimers();
    const rows: string[] = [];
    const output = createProcessOutput({
      toolName: "shell-run",
      toolCallId: "tc_1",
      onOutput: (event) => {
        if (event.content.kind === "shell-output") rows.push(event.content.text);
      },
    });

    const burst = OUTPUT_WINDOW_ROWS + 5;
    for (let line = 1; line <= burst; line++) output.chunk("stdout", `line ${line}\n`);
    jest.advanceTimersByTime(REVEAL_FRAME_MS);

    expect(rows).toHaveLength(OUTPUT_WINDOW_ROWS);
    expect(rows[0]).toBe(`line ${burst - OUTPUT_WINDOW_ROWS + 1}`);
    expect(rows.at(-1)).toBe(`line ${burst}`);
  });

  // The settled rows that follow say the same thing, so a batch still pending when the process
  // exits is dropped rather than landing after them and reading as output arriving out of order.
  test("a batch still pending when the process exits is never emitted", () => {
    jest.useFakeTimers();
    const rows: string[] = [];
    const output = createProcessOutput({
      toolName: "shell-run",
      toolCallId: "tc_1",
      onOutput: (event) => {
        if (event.content.kind === "shell-output") rows.push(event.content.text);
      },
    });

    output.chunk("stdout", "only line\n");
    expect(output.finish()).toEqual([{ stream: "stdout", text: "only line" }]);

    jest.advanceTimersByTime(1000);
    expect(rows).toEqual([]);
  });
});
