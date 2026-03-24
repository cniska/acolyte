import { describe, expect, test } from "bun:test";
import { checklistMarker, checklistProgress, formatChecklist } from "./checklist-contract";

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

describe("formatChecklist", () => {
  test("returns header with progress and sorted lines", () => {
    const result = formatChecklist({
      groupId: "g1",
      groupTitle: "Build",
      items: [
        { id: "s2", label: "test", status: "in_progress", order: 1 },
        { id: "s1", label: "lint", status: "done", order: 0 },
        { id: "s3", label: "deploy", status: "pending", order: 2 },
      ],
    });
    expect(result.header).toBe("Build (1/3)");
    expect(result.lines).toEqual(["● lint", "◐ test", "○ deploy"]);
  });

  test("handles single item", () => {
    const result = formatChecklist({
      groupId: "g1",
      groupTitle: "Quick",
      items: [{ id: "s1", label: "do it", status: "pending", order: 0 }],
    });
    expect(result.header).toBe("Quick (0/1)");
    expect(result.lines).toEqual(["○ do it"]);
  });
});
