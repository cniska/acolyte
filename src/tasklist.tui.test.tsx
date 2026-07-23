import { describe, expect, test } from "bun:test";
import type { TasklistOutput } from "./tasklist-contract";
import { layoutTranscriptTasklist } from "./terminal-chat-layout";
import { TerminalSceneRender } from "./terminal-scene-render";
import { dedent } from "./test-utils";
import { renderPlain } from "./tui/test-utils";

function renderTasklist(tasklists: TasklistOutput[], columns = 96): string {
  // Match the viewport: a 2-space gutter on every tasklist line, a blank line between rows.
  const contentWidth = Math.max(24, columns - 2);
  const lines = tasklists.flatMap((content, i) => {
    const scene = layoutTranscriptTasklist(content, contentWidth);
    const indented = scene.lines.map((line) => ({
      spans: [{ text: "  ", role: "plain" as const }, ...line.spans],
    }));
    return i > 0 ? [{ spans: [{ text: "", role: "plain" as const }] }, ...indented] : indented;
  });
  return renderPlain(<TerminalSceneRender scene={{ lines }} />, columns);
}

/** dedent with a 2-char gutter matching the tasklist spacer column. */
function expected(value: string): string {
  return dedent(value, 2);
}

describe("tasklist TUI rendering", () => {
  test("renders header with progress and status markers", () => {
    expect(
      renderTasklist([
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
          ⊙ test
          ○ deploy
      `),
    );
  });

  test("renders all status marker variants", () => {
    expect(
      renderTasklist([
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
          ⊙ active step
          ○ waiting step
          ◉ broken step
      `),
    );
  });

  test("sorts items by order regardless of input order", () => {
    expect(
      renderTasklist([
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
          ⊙ second
          ○ third
      `),
    );
  });

  test("renders nothing when there are no tasklists", () => {
    expect(renderTasklist([])).toBe("");
  });

  test("truncates an overflowing item to the content width with an ellipsis", () => {
    const out = renderTasklist(
      [
        {
          groupId: "g1",
          groupTitle: "Steps",
          items: [
            {
              id: "s1",
              label: "Wire the overflow prop end-to-end across the serialize pass and every box layout path",
              status: "in_progress",
              order: 0,
            },
          ],
        },
      ],
      40,
    );
    const widths = out.split("\n").map((line) => Bun.stringWidth(line));
    expect(Math.max(...widths)).toBeLessThanOrEqual(40);
    expect(out).toContain("…");
    expect(out).not.toContain("box layout path");
  });

  test("tasklist aligns with transcript row markers", () => {
    const output = renderTasklist([
      {
        groupId: "g1",
        groupTitle: "Steps",
        items: [{ id: "s1", label: "lint", status: "done", order: 0 }],
      },
    ]);
    // Header starts at column 2 (after 2-char spacer), matching the transcript row content column
    expect(output).toMatch(/^ {2}\S/);
  });

  test("renders multiple tasklists", () => {
    expect(
      renderTasklist([
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
      renderTasklist([
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
