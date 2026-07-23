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
    const scene = layoutTranscriptTasklist(content, contentWidth, 0);
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
  test("renders header count with the not-done items, collapsing done", () => {
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
        Build pipeline 1/3
          ◈ test
          ◇ deploy
      `),
    );
  });

  test("renders in-progress, pending, and failed markers (done collapses into the count)", () => {
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
        Steps 1/4
          ◈ active step
          ◇ waiting step
          ◆ broken step
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
        Steps 1/3
          ◈ second
          ◇ third
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
        Phase A 1/1

        Phase B 0/1
          ◇ step B
      `),
    );
  });

  test("caps not-done rows at five and folds the rest into a pending count", () => {
    expect(
      renderTasklist([
        {
          groupId: "g1",
          groupTitle: "Long",
          items: [
            { id: "d1", label: "done one", status: "done", order: 0 },
            { id: "d2", label: "done two", status: "done", order: 1 },
            { id: "p1", label: "task one", status: "in_progress", order: 2 },
            { id: "p2", label: "task two", status: "pending", order: 3 },
            { id: "p3", label: "task three", status: "pending", order: 4 },
            { id: "p4", label: "task four", status: "pending", order: 5 },
            { id: "p5", label: "task five", status: "pending", order: 6 },
            { id: "p6", label: "task six", status: "pending", order: 7 },
            { id: "p7", label: "task seven", status: "pending", order: 8 },
          ],
        },
      ]),
    ).toBe(
      expected(`
        Long 2/9
          ◈ task one
          ◇ task two
          ◇ task three
          ◇ task four
          ◇ task five
          +2 pending
      `),
    );
  });

  test("all done collapses to the header count", () => {
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
    ).toBe(expected(`Done 2/2`));
  });
});
