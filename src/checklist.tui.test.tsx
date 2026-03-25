import { describe, expect, test } from "bun:test";
import { ChatChecklist } from "./chat-checklist";
import type { ChatRow } from "./chat-contract";
import type { ChecklistOutput } from "./checklist-contract";
import { dedent } from "./test-utils";
import { renderPlain } from "./tui-test-utils";

function renderChecklist(checklists: ChecklistOutput[]): string {
  const rows: ChatRow[] = checklists.map((content, i) => ({
    id: `row_${i}`,
    kind: "task",
    content,
  }));
  return renderPlain(<ChatChecklist rows={rows} />, 96);
}

/** dedent with a 2-char gutter matching the checklist spacer column. */
function expected(value: string): string {
  return dedent(value, 2);
}

describe("checklist TUI rendering", () => {
  test("renders header with progress and status markers", () => {
    expect(
      renderChecklist([
        {
          groupId: "g1",
          groupTitle: "Build pipeline",
          items: [
            { id: "s1", label: "lint", status: "done", order: 0 },
            { id: "s2", label: "test", status: "in_progress", order: 1 },
            { id: "s3", label: "deploy", status: "pending", order: 2 },
          ],
        },
      ]),
    ).toBe(
      expected(`
        Build pipeline (1/3)
          ● lint
          ◐ test
          ○ deploy
      `),
    );
  });

  test("renders all status marker variants", () => {
    expect(
      renderChecklist([
        {
          groupId: "g1",
          groupTitle: "Steps",
          items: [
            { id: "s1", label: "done step", status: "done", order: 0 },
            { id: "s2", label: "active step", status: "in_progress", order: 1 },
            { id: "s3", label: "waiting step", status: "pending", order: 2 },
            { id: "s4", label: "broken step", status: "failed", order: 3 },
          ],
        },
      ]),
    ).toBe(
      expected(`
        Steps (1/4)
          ● done step
          ◐ active step
          ○ waiting step
          ◉ broken step
      `),
    );
  });

  test("sorts items by order regardless of input order", () => {
    expect(
      renderChecklist([
        {
          groupId: "g1",
          groupTitle: "Steps",
          items: [
            { id: "s3", label: "third", status: "pending", order: 2 },
            { id: "s1", label: "first", status: "done", order: 0 },
            { id: "s2", label: "second", status: "in_progress", order: 1 },
          ],
        },
      ]),
    ).toBe(
      expected(`
        Steps (1/3)
          ● first
          ◐ second
          ○ third
      `),
    );
  });

  test("renders nothing when rows are empty", () => {
    expect(renderPlain(<ChatChecklist rows={[]} />, 96)).toBe("");
  });

  test("checklist aligns with transcript row markers", () => {
    const output = renderChecklist([
      {
        groupId: "g1",
        groupTitle: "Steps",
        items: [{ id: "s1", label: "lint", status: "done", order: 0 }],
      },
    ]);
    // Header starts at column 2 (after 2-char spacer), matching ChatTranscriptRow content column
    expect(output).toMatch(/^ {2}\S/);
  });

  test("renders multiple checklists", () => {
    expect(
      renderChecklist([
        {
          groupId: "g1",
          groupTitle: "Phase A",
          items: [{ id: "a1", label: "step A", status: "done", order: 0 }],
        },
        {
          groupId: "g2",
          groupTitle: "Phase B",
          items: [{ id: "b1", label: "step B", status: "pending", order: 0 }],
        },
      ]),
    ).toBe(
      expected(`
        Phase A (1/1)
          ● step A

        Phase B (0/1)
          ○ step B
      `),
    );
  });

  test("all done shows full progress", () => {
    expect(
      renderChecklist([
        {
          groupId: "g1",
          groupTitle: "Done",
          items: [
            { id: "s1", label: "a", status: "done", order: 0 },
            { id: "s2", label: "b", status: "done", order: 1 },
          ],
        },
      ]),
    ).toBe(
      expected(`
        Done (2/2)
          ● a
          ● b
      `),
    );
  });
});
