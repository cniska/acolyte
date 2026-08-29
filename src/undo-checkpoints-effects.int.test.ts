import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "./test-utils";
import { createSessionContext } from "./tool-session";
import { listUndoCheckpoints } from "./undo-checkpoints";
import { attachUndoCheckpointSideEffects } from "./undo-checkpoints-effects";

const dirs = tempDir();

afterEach(dirs.cleanupDirs);

describe("undo checkpoint side effects", () => {
  test("does not create a checkpoint when a tool call fails", async () => {
    const workspace = dirs.createDir("acolyte-undo-fail-");
    const sessionId = "sess_fail";
    await writeFile(join(workspace, "a.txt"), "one\n", "utf8");
    const session = createSessionContext("task_fail");
    attachUndoCheckpointSideEffects({
      workspace,
      sessionId,
      session,
      writeToolSet: new Set(["file-edit"]),
    });

    await session.onBeforeToolAsync?.({
      toolId: "file-edit",
      toolCallId: "call_1",
      args: { path: "a.txt" },
    });
    await session.onAfterToolAsync?.({
      toolId: "file-edit",
      toolCallId: "call_1",
      args: { path: "a.txt" },
      status: "failed",
      error: { message: "boom" },
    });

    const listed = await listUndoCheckpoints({ workspace, sessionId, limit: 10 });
    expect(listed).toEqual([]);
  });
});

test("passes the lifecycle effects' tool-result append through untouched", async () => {
  const workspace = dirs.createDir("acolyte-undo-append-");
  const session = createSessionContext("task_append");
  // The lifecycle effects attach first, so this stands in for the lint output they contribute.
  session.onAfterToolAsync = async () => ({ append: "Lint errors:\nsrc/a.ts: no-explicit-any" });

  attachUndoCheckpointSideEffects({
    workspace,
    sessionId: "sess_append",
    session,
    writeToolSet: new Set(["file-edit"]),
  });

  const output = await session.onAfterToolAsync?.({
    toolId: "file-edit",
    toolCallId: "call_1",
    args: { path: "a.txt" },
    status: "succeeded",
    result: {},
  });

  expect(output).toEqual({ append: "Lint errors:\nsrc/a.ts: no-explicit-any" });
});
