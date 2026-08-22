import { describe, expect, test } from "bun:test";
import { createMessageStreamState } from "./chat-message-handler-stream";
import { createStdoutRowProjector } from "./cli-stdout-projector";
import type { ToolOutputPart } from "./tool-output-contract";
import { stripAnsi } from "./tui/serialize";

function captureStdout(run: () => void): string {
  const chunks: string[] = [];
  const saved = process.stdout.write;
  process.stdout.write = ((data: string) => {
    chunks.push(String(data));
    return true;
  }) as typeof process.stdout.write;
  try {
    run();
  } finally {
    process.stdout.write = saved;
  }
  return chunks.join("");
}

const shellLine = (text: string): ToolOutputPart => ({ kind: "shell-output", stream: "stdout", text });

describe("run mode tool output", () => {
  test("a streaming tool prints its settled output once, with no duplicated lines", () => {
    const written = captureStdout(() => {
      const projector = createStdoutRowProjector();
      const state = createMessageStreamState({ setRows: projector.setRows, appendOnlyRows: true });
      const emit = (content: ToolOutputPart, transient?: boolean) =>
        state.onOutput({ toolCallId: "tc_1", toolName: "shell-run", content, transient });

      emit({ kind: "tool-header", labelKey: "tool.label.shell_run", detail: "bun build" });
      // A rolling live window: stdout cannot take a printed line back, so none of these
      // may reach it — printing them strands a shifting window mid-stream.
      for (let i = 1; i <= 20; i++) emit(shellLine(`line-${i}`), true);
      emit(shellLine("line-1"));
      emit({ kind: "truncated", count: 18, unit: "lines" });
      emit(shellLine("line-20"));
    });

    const clean = stripAnsi(written);
    const outLines = clean
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("out |"));

    expect(outLines).toEqual(["out | line-1", "out | line-20"]);
    expect(clean).toContain("+18 lines");
    // Intermediate window rows never belong on an append-only stream.
    expect(clean).not.toContain("line-7");
  });
});
