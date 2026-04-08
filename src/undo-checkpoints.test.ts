import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "./test-utils";
import {
  captureUndoBefore,
  commitUndoCheckpoint,
  listUndoCheckpoints,
  restoreUndoCheckpoint,
} from "./undo-checkpoints";

const dirs = tempDir();

afterEach(dirs.cleanupDirs);

describe("undo checkpoints", () => {
  test("captures before/after and restores when workspace matches after snapshot", async () => {
    const workspace = dirs.createDir("acolyte-undo-");
    const sessionId = "sess_undo";
    await mkdir(join(workspace, ".acolyte"), { recursive: true });
    await writeFile(join(workspace, "a.txt"), "one\n", "utf8");

    const pending = await captureUndoBefore({
      workspace,
      toolCallId: "call_1",
      toolId: "file-edit",
      paths: ["a.txt"],
    });

    await writeFile(join(workspace, "a.txt"), "two\n", "utf8");
    const entry = await commitUndoCheckpoint({ workspace, sessionId, pending });

    const listed = await listUndoCheckpoints({ workspace, sessionId, limit: 10 });
    expect(listed.length).toBe(1);
    expect(listed[0]?.id).toBe(entry.id);
    expect(listed[0]?.paths).toEqual(["a.txt"]);

    // Conflict: workspace doesn't match the after snapshot.
    await writeFile(join(workspace, "a.txt"), "three\n", "utf8");
    const conflict = await restoreUndoCheckpoint({
      workspace,
      sessionId,
      checkpointId: entry.id,
      paths: ["a.txt"],
    });
    expect(conflict.restored).toEqual([]);
    expect(conflict.conflicts.length).toBe(1);
    expect(await readFile(join(workspace, "a.txt"), "utf8")).toBe("three\n");

    // Restore succeeds when workspace matches the after snapshot ("two\n").
    await writeFile(join(workspace, "a.txt"), "two\n", "utf8");
    const restored = await restoreUndoCheckpoint({
      workspace,
      sessionId,
      checkpointId: entry.id,
      paths: ["a.txt"],
    });
    expect(restored.conflicts).toEqual([]);
    expect(restored.restored).toEqual(["a.txt"]);
    expect(await readFile(join(workspace, "a.txt"), "utf8")).toBe("one\n");
  });

  test("refuses to restore when before snapshot is too large to store", async () => {
    const workspace = dirs.createDir("acolyte-undo-large-");
    const sessionId = "sess_large";
    const big = new Uint8Array(300_000);
    big.fill("a".charCodeAt(0));
    await writeFile(join(workspace, "big.txt"), big);

    const pending = await captureUndoBefore({
      workspace,
      toolCallId: "call_1",
      toolId: "file-edit",
      paths: ["big.txt"],
    });
    // Mutate the file so the checkpoint captures an "after".
    big.fill("b".charCodeAt(0));
    await writeFile(join(workspace, "big.txt"), big);
    const entry = await commitUndoCheckpoint({ workspace, sessionId, pending });

    const result = await restoreUndoCheckpoint({
      workspace,
      sessionId,
      checkpointId: entry.id,
      paths: ["big.txt"],
    });
    expect(result.restored).toEqual([]);
    expect(result.conflicts).toEqual([{ path: "big.txt", reason: "missing_before_snapshot" }]);
  });

  test("prunes older checkpoints beyond max", async () => {
    const workspace = dirs.createDir("acolyte-undo-prune-");
    const sessionId = "sess_prune";
    await writeFile(join(workspace, "a.txt"), "one\n", "utf8");
    for (let i = 1; i <= 3; i++) {
      const pending = await captureUndoBefore({
        workspace,
        toolCallId: `call_${i}`,
        toolId: "file-edit",
        paths: ["a.txt"],
      });
      await writeFile(join(workspace, "a.txt"), `v${i}\n`, "utf8");
      await commitUndoCheckpoint({ workspace, sessionId, pending, maxCheckpoints: 2 });
    }
    const listed = await listUndoCheckpoints({ workspace, sessionId, limit: 10 });
    expect(listed.length).toBe(2);
    // Latest two calls remain.
    expect(listed[0]?.toolCallId).toBe("call_3");
    expect(listed[1]?.toolCallId).toBe("call_2");
  });
});
