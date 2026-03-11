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

  test("allows detached and resumed transitions", () => {
    const registry = new TaskRegistry();
    expect(registry.transitionTask("task_2", { state: "running" }).ok).toBe(true);
    expect(registry.transitionTask("task_2", { state: "detached" }).ok).toBe(true);
    expect(registry.transitionTask("task_2", { state: "running" }).ok).toBe(true);
    expect(registry.get("task_2")?.state).toBe("running");
  });

  test("reports per-state summary counts", () => {
    const registry = new TaskRegistry();
    expect(registry.transitionTask("task_running", { state: "running" }).ok).toBe(true);
    expect(registry.transitionTask("task_detached", { state: "detached" }).ok).toBe(true);
    expect(registry.transitionTask("task_completed", { state: "completed" }).ok).toBe(true);
    expect(registry.transitionTask("task_failed", { state: "failed" }).ok).toBe(true);
    expect(registry.transitionTask("task_cancelled", { state: "cancelled" }).ok).toBe(true);

    expect(registry.summary()).toEqual({
      total: 5,
      running: 1,
      detached: 1,
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

describe("task transition rules", () => {
  test("enforces transition allowlist", () => {
    expect(canTransitionTaskState("running", "completed")).toBe(true);
    expect(canTransitionTaskState("running", "detached")).toBe(true);
    expect(canTransitionTaskState("completed", "running")).toBe(false);
    expect(canTransitionTaskState("failed", "detached")).toBe(false);
  });
});
