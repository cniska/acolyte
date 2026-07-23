import { describe, expect, test } from "bun:test";
import { tasklistMarker, tasklistProgress } from "./tasklist-contract";

describe("tasklistMarker", () => {
  test("returns correct markers", () => {
    expect(tasklistMarker("pending")).toBe("◇");
    expect(tasklistMarker("in_progress")).toBe("◈");
    expect(tasklistMarker("done")).toBe("◆");
    expect(tasklistMarker("failed")).toBe("◆");
  });
});

describe("tasklistProgress", () => {
  test("counts done items", () => {
    expect(
      tasklistProgress([
        { id: "1", label: "a", status: "done", order: 0 },
        { id: "2", label: "b", status: "in_progress", order: 1 },
        { id: "3", label: "c", status: "pending", order: 2 },
      ]),
    ).toEqual({ done: 1, total: 3 });
  });

  test("handles all done", () => {
    expect(
      tasklistProgress([
        { id: "1", label: "a", status: "done", order: 0 },
        { id: "2", label: "b", status: "done", order: 1 },
      ]),
    ).toEqual({ done: 2, total: 2 });
  });

  test("failed items do not count as done", () => {
    expect(
      tasklistProgress([
        { id: "1", label: "a", status: "done", order: 0 },
        { id: "2", label: "b", status: "failed", order: 1 },
      ]),
    ).toEqual({ done: 1, total: 2 });
  });

  test("handles empty list", () => {
    expect(tasklistProgress([])).toEqual({ done: 0, total: 0 });
  });
});
