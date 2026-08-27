import type { ShellLine, ToolOutputListener } from "./tool-output-format";
import { OUTPUT_WINDOW_ROWS, REVEAL_FRAME_MS } from "./tool-policy";

export type ProcessOutput = {
  /** Feed one raw chunk from the process. Rows are emitted per completed line, batched. */
  chunk: (stream: "stdout" | "stderr", text: string) => void;
  /** Flush the last partial line, stop emitting, and return every line the process printed. */
  finish: () => ShellLine[];
};

/** Turns a process's raw output into the rows a tool row shows, shared by every tool that runs
 *  one. A process writes when its buffer fills rather than when a line ends, so a line arrives in
 *  pieces and is held until its newline: the row is the unit a reader scans, and a line broken
 *  across two rows reads as two. */
export function createProcessOutput(input: {
  toolName: string;
  toolCallId: string;
  onOutput: ToolOutputListener;
}): ProcessOutput {
  const recorded: ShellLine[] = [];
  const partial: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };
  let pending: ShellLine[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const flush = (): void => {
    timer = null;
    const rows = pending.slice(-OUTPUT_WINDOW_ROWS);
    pending = [];
    for (const row of rows) {
      input.onOutput({
        toolName: input.toolName,
        content: { kind: "shell-output", stream: row.stream, text: row.text },
        toolCallId: input.toolCallId,
        transient: true,
      });
    }
  };

  const record = (stream: "stdout" | "stderr", text: string): void => {
    recorded.push({ stream, text });
    if (stopped) return;
    pending.push({ stream, text });
    // A command can print faster than anything downstream can consume, and only the newest rows are
    // ever displayed. Coalescing on the paint frame bounds repaints to one per frame — the most the
    // screen can show — without changing what the reader sees.
    if (!timer) timer = setTimeout(flush, REVEAL_FRAME_MS);
  };

  return {
    chunk(stream, text) {
      let remaining = partial[stream] + text;
      while (true) {
        const at = remaining.indexOf("\n");
        if (at === -1) break;
        const line = remaining.slice(0, at).trimEnd();
        remaining = remaining.slice(at + 1);
        if (line.length > 0) record(stream, line);
      }
      partial[stream] = remaining;
    },
    finish() {
      // Anything still batched is dropped: the preview rows that follow say the same thing, and a
      // stale live row landing after them would read as output arriving out of order.
      if (timer) clearTimeout(timer);
      timer = null;
      stopped = true;
      for (const stream of ["stdout", "stderr"] as const) {
        const remainder = partial[stream].trimEnd();
        partial[stream] = "";
        if (remainder.length > 0) record(stream, remainder);
      }
      return recorded;
    },
  };
}
