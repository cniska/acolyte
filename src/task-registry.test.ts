import { describe, expect, test } from "bun:test";
import { canTransitionTaskState, TaskRegistry } from "./task-registry";

describe("task registry", () => {
  test("creates and updates task records", async () => {
    const registry = new TaskRegistry();

    const createdResult = registry.transitionTask("task_1", { state: "running" });
    expect(createdResult.ok).toBe(true);
    if (!createdResult.ok) throw new Error("Expected successful upsert");
    const created = createdResult.task;
    expect(created.id).toBe("task_1");
    expect(created.state).toBe("running");
    expect(typeof created.createdAt).toBe("string");
    expect(typeof created.updatedAt).toBe("string");

    await Bun.sleep(1);
    const updatedResult = registry.transitionTask("task_1", { state: "completed", summary: "done" });
    expect(updatedResult.ok).toBe(true);
    if (!updatedResult.ok) throw new Error("Expected successful upsert");
    const updated = updatedResult.task;
    expect(updated.id).toBe("task_1");
    expect(updated.state).toBe("completed");
    expect(updated.summary).toBe("done");
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
});

describe("task transition rules", () => {
  test("enforces transition allowlist", () => {
    expect(canTransitionTaskState("running", "completed")).toBe(true);
    expect(canTransitionTaskState("running", "detached")).toBe(true);
    expect(canTransitionTaskState("completed", "running")).toBe(false);
    expect(canTransitionTaskState("failed", "detached")).toBe(false);
  });
});
