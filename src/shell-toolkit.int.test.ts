import { afterAll, describe, expect, test } from "bun:test";
import { createShellToolkit } from "./shell-toolkit";
import { tempDir } from "./test-utils";
import type { ToolkitInput } from "./tool-contract";
import { createSessionContext } from "./tool-session";

type Captured = { text: string; transient: boolean; beforeSettle: boolean };

const { createDir, cleanupDirs } = tempDir();
afterAll(cleanupDirs);

function harness(): { input: ToolkitInput; captured: Captured[]; settle: () => void } {
  const captured: Captured[] = [];
  let settled = false;
  const input: ToolkitInput = {
    workspace: createDir("shell-toolkit"),
    session: createSessionContext(),
    onOutput: (event) => {
      if (event.content.kind !== "shell-output") return;
      captured.push({ text: event.content.text, transient: event.transient === true, beforeSettle: !settled });
    },
    onTasklist: () => {},
    onSkillActivated: () => {},
    onSkillDeactivated: () => {},
  };
  return {
    input,
    captured,
    settle: () => {
      settled = true;
    },
  };
}

describe("shell-run output", () => {
  test("emits completed lines while the command is still running", async () => {
    const { input, captured, settle } = harness();
    const toolkit = createShellToolkit(input);
    await toolkit.runCommand.execute(
      {
        cmd: "bun",
        args: ["-e", 'console.log("FIRST"); await new Promise((r) => setTimeout(r, 300)); console.log("SECOND")'],
      },
      "tc_stream",
    );
    settle();

    const first = captured.find((entry) => entry.text === "FIRST");
    expect(first).toBeDefined();
    expect(first?.transient).toBe(true);
    expect(first?.beforeSettle).toBe(true);
  });

  test("keeps output produced before a timeout", async () => {
    const { input, captured, settle } = harness();
    const toolkit = createShellToolkit(input);
    await toolkit.runCommand
      .execute(
        {
          cmd: "bun",
          args: ["-e", 'console.log("BEFORE_TIMEOUT"); await new Promise((r) => setTimeout(r, 5000))'],
          timeoutMs: 1000,
        },
        "tc_timeout",
      )
      .catch(() => undefined);
    settle();

    expect(captured.some((entry) => entry.text === "BEFORE_TIMEOUT" && entry.transient)).toBe(true);
  });
});
