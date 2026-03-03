import { describe, expect, test } from "bun:test";
import { isTerminalTaskState, taskRecordSchema, taskStateSchema } from "./task-contract";

describe("task state contract", () => {
  test("accepts all planned task states", () => {
    expect(taskStateSchema.safeParse("accepted").success).toBe(true);
    expect(taskStateSchema.safeParse("queued").success).toBe(true);
    expect(taskStateSchema.safeParse("running").success).toBe(true);
    expect(taskStateSchema.safeParse("detached").success).toBe(true);
    expect(taskStateSchema.safeParse("completed").success).toBe(true);
    expect(taskStateSchema.safeParse("failed").success).toBe(true);
    expect(taskStateSchema.safeParse("cancelled").success).toBe(true);
    expect(taskStateSchema.safeParse("unknown").success).toBe(false);
  });

  test("validates task record shape", () => {
    const parsed = taskRecordSchema.safeParse({
      id: "task_123",
      state: "running",
      createdAt: "2026-02-28T00:00:00.000Z",
      updatedAt: "2026-02-28T00:00:01.000Z",
      summary: "Doing work",
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects non-ISO datetime values in task record", () => {
    const parsed = taskRecordSchema.safeParse({
      id: "task_123",
      state: "running",
      createdAt: "not-a-datetime",
      updatedAt: "2026-02-28T00:00:01.000Z",
    });
    expect(parsed.success).toBe(false);
  });

  test("detects terminal vs non-terminal states", () => {
    expect(isTerminalTaskState("accepted")).toBe(false);
    expect(isTerminalTaskState("queued")).toBe(false);
    expect(isTerminalTaskState("running")).toBe(false);
    expect(isTerminalTaskState("detached")).toBe(false);
    expect(isTerminalTaskState("completed")).toBe(true);
    expect(isTerminalTaskState("failed")).toBe(true);
    expect(isTerminalTaskState("cancelled")).toBe(true);
  });
});
