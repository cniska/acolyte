import { describe, expect, test } from "bun:test";
import { TaskRegistry } from "./task-registry";

describe("task registry", () => {
  test("creates and updates task records", async () => {
    const registry = new TaskRegistry();

    const created = registry.upsert("task_1", { state: "running" });
    expect(created.id).toBe("task_1");
    expect(created.state).toBe("running");
    expect(typeof created.createdAt).toBe("string");
    expect(typeof created.updatedAt).toBe("string");

    await Bun.sleep(1);
    const updated = registry.upsert("task_1", { state: "completed", summary: "done" });
    expect(updated.id).toBe("task_1");
    expect(updated.state).toBe("completed");
    expect(updated.summary).toBe("done");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt >= created.updatedAt).toBe(true);

    expect(registry.get("task_1")?.state).toBe("completed");
    expect(registry.get("missing")).toBeNull();
  });
});
