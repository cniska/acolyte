import { describe, expect, test } from "bun:test";
import { createSignalToolkit, signalForToolName } from "./signal-toolkit";
import { createSessionContext } from "./tool-session";

const noop = () => {};

function toolkit() {
  return createSignalToolkit({
    workspace: process.cwd(),
    session: createSessionContext("task_signal"),
    onOutput: noop,
    onChecklist: noop,
  });
}

describe("signal tools", () => {
  test("maps tool names to lifecycle signals", () => {
    expect(signalForToolName("signal_done")).toBe("done");
    expect(signalForToolName("signal_no_op")).toBe("no_op");
    expect(signalForToolName("signal_blocked")).toBe("blocked");
    expect(signalForToolName("file-read")).toBeUndefined();
  });

  test("signal_done has no arguments", async () => {
    const result = await toolkit().signalDone.execute({}, "call_done");
    expect(result.result).toEqual({ kind: "lifecycle-signal", signal: "done" });
  });

  test("signal_done bypasses step budget while still recording the call", async () => {
    const session = createSessionContext("task_signal");
    session.flags.turnStepLimit = 0;
    const tools = createSignalToolkit({
      workspace: process.cwd(),
      session,
      onOutput: noop,
      onChecklist: noop,
    });

    const result = await tools.signalDone.execute({}, "call_done");
    expect(result.result).toEqual({ kind: "lifecycle-signal", signal: "done" });
    expect(session.callLog.map((entry) => entry.toolName)).toEqual(["signal_done"]);
  });

  test("signal_blocked requires a reason", async () => {
    await expect(toolkit().signalBlocked.execute({} as { reason: string }, "call_blocked")).rejects.toThrow();
    const result = await toolkit().signalBlocked.execute(
      { reason: "Missing credentials. I will deploy after they are provided." },
      "call_blocked",
    );
    expect(result.result).toEqual({
      kind: "lifecycle-signal",
      signal: "blocked",
      reason: "Missing credentials. I will deploy after they are provided.",
    });
  });
});
