import { describe, expect, test } from "bun:test";
import { formatChecklist } from "./checklist-format";

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
