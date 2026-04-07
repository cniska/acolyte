import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionContext } from "./tool-session";
import { listUndoCheckpoints } from "./undo-checkpoints";
import { attachUndoCheckpointSideEffects } from "./undo-checkpoints-effects";

describe("undo checkpoint side effects", () => {
  test("does not create a checkpoint when a tool call fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "acolyte-undo-fail-"));
    const sessionId = "sess_fail";
    try {
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
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
