import { describe, expect, test } from "bun:test";
import { checklistMarker, checklistProgress } from "./checklist-contract";

describe("checklistMarker", () => {
  test("returns correct markers", () => {
    expect(checklistMarker("pending")).toBe("○");
    expect(checklistMarker("in_progress")).toBe("◐");
    expect(checklistMarker("done")).toBe("●");
    expect(checklistMarker("failed")).toBe("◉");
  });
});

describe("checklistProgress", () => {
  test("counts done items", () => {
    expect(
      checklistProgress([
        { id: "1", label: "a", status: "done", order: 0 },
        { id: "2", label: "b", status: "in_progress", order: 1 },
        { id: "3", label: "c", status: "pending", order: 2 },
      ]),
    ).toEqual({ done: 1, total: 3 });
  });

  test("handles all done", () => {
    expect(
      checklistProgress([
        { id: "1", label: "a", status: "done", order: 0 },
        { id: "2", label: "b", status: "done", order: 1 },
      ]),
    ).toEqual({ done: 2, total: 2 });
  });

  test("failed items do not count as done", () => {
    expect(
      checklistProgress([
        { id: "1", label: "a", status: "done", order: 0 },
        { id: "2", label: "b", status: "failed", order: 1 },
      ]),
    ).toEqual({ done: 1, total: 2 });
  });

  test("handles empty list", () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0 });
  });
});
