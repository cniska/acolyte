import { describe, expect, test } from "bun:test";
import { createSessionToolkit } from "./session-toolkit";
import { createSessionContext } from "./tool-session";

const noop = () => {};

function toolkit() {
  return createSessionToolkit({
    workspace: process.cwd(),
    session: createSessionContext("task_session"),
    onOutput: noop,
    onChecklist: noop,
  });
}

describe("session toolkit", () => {
  test("session-handoff requests a review without mutating session state", async () => {
    const session = createSessionContext("task_session");
    const tools = createSessionToolkit({
      workspace: process.cwd(),
      session,
      onOutput: noop,
      onChecklist: noop,
    });

    const result = await tools.sessionHandoff.execute(
      { reason: "Need a clean summary before continuing." },
      "call_handoff",
    );

    expect(result.result).toEqual({
      kind: "session-handoff",
      requested: true,
      reason: "Need a clean summary before continuing.",
    });
    expect(session.callLog.map((entry) => entry.toolName)).toEqual(["session-handoff"]);
  });

  test("session-handoff output rejects unexpected shapes", async () => {
    const tools = toolkit();
    await expect(
      tools.sessionHandoff.outputSchema.parseAsync({
        kind: "session-handoff",
        requested: true,
        reason: "",
      }),
    ).rejects.toThrow();
  });
});
