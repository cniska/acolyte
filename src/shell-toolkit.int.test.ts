import { afterAll, describe, expect, test } from "bun:test";
import { createShellToolkit } from "./shell-toolkit";
import { tempDir } from "./test-utils";
import type { ToolkitInput } from "./tool-contract";
import { createSessionContext } from "./tool-session";

type Captured = { text: string; transient: boolean };

const { createDir, cleanupDirs } = tempDir();
afterAll(cleanupDirs);

function harness(): { input: ToolkitInput; captured: Captured[] } {
  const captured: Captured[] = [];
  const input: ToolkitInput = {
    workspace: createDir("shell-toolkit"),
    session: createSessionContext(),
    onOutput: (event) => {
      if (event.content.kind !== "shell-output") return;
      captured.push({ text: event.content.text, transient: event.transient === true });
    },
    onTasklist: () => {},
    onSkillActivated: () => {},
    onSkillDeactivated: () => {},
  };
  return { input, captured };
}

const sleeper = (before: string, ms: number, after: string): string[] => [
  "-e",
  `console.log("${before}"); await new Promise((r) => setTimeout(r, ${ms})); console.log("${after}")`,
];

describe("shell-run output", () => {
  test("emits completed lines while the command is still running", async () => {
    const { input, captured } = harness();
    const toolkit = createShellToolkit(input);
    // Prints immediately, then stays alive well past the mid-run probe below. Buffering the
    // output until the process exits leaves `captured` empty at the probe, so this fails.
    const pending = toolkit.runCommand.execute(
      { cmd: "bun", args: sleeper("FIRST", 3000, "SECOND"), timeoutMs: 20000 },
      "tc_stream",
    );

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const midRun = captured.map((entry) => entry.text);
    await pending;

    expect(midRun).toContain("FIRST");
    expect(midRun).not.toContain("SECOND");
    expect(captured.find((entry) => entry.text === "FIRST")?.transient).toBe(true);
  });

  test("a burst of output does not become a burst of events", async () => {
    const { input, captured } = harness();
    const toolkit = createShellToolkit(input);
    await toolkit.runCommand.execute(
      { cmd: "bun", args: ["-e", 'for (let i = 0; i < 2000; i++) console.log("row-" + i)'], timeoutMs: 20000 },
      "tc_burst",
    );

    // Only the newest rows are ever displayed, so one event per line is pure waste — it
    // crosses the wire and lands in the trace store.
    expect(captured.length).toBeLessThan(100);
  });

  test("a timed-out command keeps its output and stops streaming", async () => {
    const { input, captured } = harness();
    const toolkit = createShellToolkit(input);
    const failure = await toolkit.runCommand
      .execute({ cmd: "bun", args: sleeper("BEFORE_TIMEOUT", 5000, "NEVER"), timeoutMs: 1000 }, "tc_timeout")
      .then(() => undefined)
      .catch((error: unknown) => error as Error);
    const emittedAtReturn = captured.length;

    // A timeout stays a failure, but the model must still see what the command printed.
    expect(failure?.message).toMatch(/timed out/i);
    expect(failure?.message).toContain("BEFORE_TIMEOUT");
    expect(captured.some((entry) => entry.text === "BEFORE_TIMEOUT" && entry.transient)).toBe(true);

    // Nothing may keep streaming into a call that has already returned.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(captured).toHaveLength(emittedAtReturn);
  });
});
