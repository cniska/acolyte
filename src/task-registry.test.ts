import { describe, expect, test } from "bun:test";
import { invariant } from "./assert";
import { canTransitionTaskState, TaskRegistry } from "./task-registry";

describe("task registry", () => {
  test("creates and updates task records", async () => {
    const registry = new TaskRegistry();

    const createdResult = registry.transitionTask("task_1", { state: "running" });
    expect(createdResult.ok).toBe(true);
    invariant(createdResult.ok, "Expected successful upsert");
    const created = createdResult.task;
    expect(created.id).toBe("task_1");
    expect(created.state).toBe("running");
    expect(typeof created.createdAt).toBe("string");
    expect(typeof created.updatedAt).toBe("string");

    await Bun.sleep(1);
    const updatedResult = registry.transitionTask("task_1", { state: "completed" });
    expect(updatedResult.ok).toBe(true);
    invariant(updatedResult.ok, "Expected successful upsert");
    const updated = updatedResult.task;
    expect(updated.id).toBe("task_1");
    expect(updated.state).toBe("completed");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt >= created.updatedAt).toBe(true);

    expect(registry.get("task_1")?.state).toBe("completed");
    expect(registry.get("missing")).toBeNull();
  });

  test("rejects invalid transitions from terminal states", () => {
    const registry = new TaskRegistry();
    const createdResult = registry.transitionTask("task_1", { state: "completed" });
    expect(createdResult.ok).toBe(true);

    const invalid = registry.transitionTask("task_1", { state: "running" });
    expect(invalid).toEqual({
      ok: false,
      code: "E_TASK_INVALID_TRANSITION",
      taskId: "task_1",
      fromState: "completed",
      toState: "running",
    });
    expect(registry.get("task_1")?.state).toBe("completed");
  });

  test("reports per-state summary counts", () => {
    const registry = new TaskRegistry();
    expect(registry.transitionTask("task_running", { state: "running" }).ok).toBe(true);
    expect(registry.transitionTask("task_completed", { state: "completed" }).ok).toBe(true);
    expect(registry.transitionTask("task_failed", { state: "failed" }).ok).toBe(true);
    expect(registry.transitionTask("task_cancelled", { state: "cancelled" }).ok).toBe(true);

    expect(registry.summary()).toEqual({
      total: 4,
      running: 1,
      completed: 1,
      failed: 1,
      cancelled: 1,
    });
  });

  test("evicts oldest terminal tasks when maxTasks is exceeded", () => {
    const registry = new TaskRegistry({ maxTasks: 3 });
    expect(registry.transitionTask("task_running", { state: "running" }).ok).toBe(true);
    expect(registry.transitionTask("task_done_1", { state: "completed" }).ok).toBe(true);
    expect(registry.transitionTask("task_done_2", { state: "failed" }).ok).toBe(true);
    expect(registry.summary().total).toBe(3);

    // Adding another terminal task should evict the oldest terminal one.
    expect(registry.transitionTask("task_done_3", { state: "cancelled" }).ok).toBe(true);

    expect(registry.get("task_running")?.state).toBe("running");
    expect(registry.get("task_done_1")).toBeNull();
    expect(registry.get("task_done_2")?.state).toBe("failed");
    expect(registry.get("task_done_3")?.state).toBe("cancelled");
    expect(registry.summary().total).toBe(3);
  });
});

describe("live tasks", () => {
  test("reports every unfinished task, carrying the session it belongs to", () => {
    const registry = new TaskRegistry();
    registry.transitionTask("task_running", { state: "running", sessionId: "sess_one" });
    registry.transitionTask("task_queued", { state: "queued", sessionId: "sess_two" });
    registry.transitionTask("task_accepted", { state: "accepted", sessionId: "sess_three" });

    // Queued and accepted work is abandoned by a stop just as a running turn is.
    expect(registry.liveTasks()).toEqual([
      { taskId: "task_running", sessionId: "sess_one" },
      { taskId: "task_queued", sessionId: "sess_two" },
      { taskId: "task_accepted", sessionId: "sess_three" },
    ]);
  });

  test("reports nothing once every task reached a terminal state", () => {
    const registry = new TaskRegistry();
    registry.transitionTask("task_done", { state: "running", sessionId: "sess_one" });
    registry.transitionTask("task_done", { state: "completed" });
    registry.transitionTask("task_failed", { state: "running" });
    registry.transitionTask("task_failed", { state: "failed" });
    registry.transitionTask("task_cancelled", { state: "cancelled" });

    expect(registry.liveTasks()).toEqual([]);
  });

  test("keeps the session across later transitions", () => {
    const registry = new TaskRegistry();
    registry.transitionTask("task_live", { state: "accepted", sessionId: "sess_one" });
    registry.transitionTask("task_live", { state: "running" });

    expect(registry.liveTasks()).toEqual([{ taskId: "task_live", sessionId: "sess_one" }]);
  });

  test("reports a task with no session as null rather than omitting it", () => {
    const registry = new TaskRegistry();
    registry.transitionTask("task_live", { state: "running" });

    expect(registry.liveTasks()).toEqual([{ taskId: "task_live", sessionId: null }]);
  });
});

describe("task transition rules", () => {
  test("enforces transition allowlist", () => {
    expect(canTransitionTaskState("running", "completed")).toBe(true);
    expect(canTransitionTaskState("completed", "running")).toBe(false);
    expect(canTransitionTaskState("failed", "running")).toBe(false);
  });
});
