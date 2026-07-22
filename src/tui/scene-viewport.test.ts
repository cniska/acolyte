import { expect, test } from "bun:test";
import type { TerminalScene } from "../terminal-scene-contract";
import { fitSceneViewport, planScenePromotion, promoteSceneSlices, sceneCursorPlacement } from "./scene-viewport";

function line(text: string): { spans: [{ text: string; role: "plain" }] } {
  return { spans: [{ text, role: "plain" }] };
}

test("scene viewport commits only finalized sections above the live tail", () => {
  const scene = {
    lines: [
      { spans: [{ text: "one", role: "plain" as const }] },
      { spans: [{ text: "two", role: "plain" as const }] },
      { spans: [{ text: "three", role: "plain" as const }] },
    ],
    sections: [
      { id: "complete", lineStart: 0, lineEnd: 1, finalized: true },
      { id: "live", lineStart: 1, lineEnd: 3, finalized: false },
    ],
    cursor: { row: 2, column: 3 },
  };
  const fit = fitSceneViewport(scene, { columns: 20, rows: 3 });
  expect(fit).toEqual({ liveLineStart: 1, committedSectionIds: ["complete"] });
  expect(sceneCursorPlacement(scene, fit.liveLineStart)).toEqual({ row: 1, column: 3 });
});

const promotionScene: TerminalScene = {
  lines: [
    { spans: [{ text: "header", role: "plain" }] },
    { spans: [{ text: "", role: "plain" }] },
    { spans: [{ text: "row a", role: "plain" }] },
    { spans: [{ text: "", role: "plain" }] },
    { spans: [{ text: "live", role: "plain" }] },
  ],
  sections: [
    { id: "header", lineStart: 0, lineEnd: 1, finalized: true },
    { id: "row_a", lineStart: 2, lineEnd: 3, finalized: true },
    { id: "composer", lineStart: 4, lineEnd: 5, finalized: false },
  ],
};

test("promoteSceneSlices extracts each committed section's own lines in order", () => {
  const slices = promoteSceneSlices(promotionScene, ["header", "row_a"], new Set());
  expect(slices).toEqual([
    { id: "header", lines: [{ spans: [{ text: "header", role: "plain" }] }] },
    { id: "row_a", lines: [{ spans: [{ text: "row a", role: "plain" }] }] },
  ]);
});

test("promoteSceneSlices skips already-promoted and unknown ids", () => {
  const slices = promoteSceneSlices(promotionScene, ["header", "row_a", "ghost"], new Set(["header"]));
  expect(slices.map((slice) => slice.id)).toEqual(["row_a"]);
});

test("promoteSceneSlices freezes slice lines and spans", () => {
  const [slice] = promoteSceneSlices(promotionScene, ["header"], new Set());
  expect(Object.isFrozen(slice)).toBe(true);
  expect(Object.isFrozen(slice?.lines)).toBe(true);
  expect(Object.isFrozen(slice?.lines[0])).toBe(true);
  expect(Object.isFrozen(slice?.lines[0]?.spans)).toBe(true);
});

// header [0,1) | blank 1 | row1 [2,3) | blank 3 | row2 [4,5) | blank 5 | composer [6,7)
function planScene(overrides: { row1Final?: boolean; row2Final?: boolean } = {}): TerminalScene {
  return {
    lines: [line("header"), line(""), line("row1"), line(""), line("row2"), line(""), line("composer")],
    sections: [
      { id: "header", lineStart: 0, lineEnd: 1, finalized: true },
      { id: "row1", lineStart: 2, lineEnd: 3, finalized: overrides.row1Final ?? true },
      { id: "row2", lineStart: 4, lineEnd: 5, finalized: overrides.row2Final ?? true },
      { id: "composer", lineStart: 6, lineEnd: 7, finalized: false },
    ],
  };
}

test("planScenePromotion commits no rows when everything fits; live tail starts after the header", () => {
  const plan = planScenePromotion(planScene(), { columns: 20, rows: 40 }, new Set());
  expect(plan.committedSectionIds).toEqual([]);
  expect(plan.liveLineStart).toBe(1);
  expect(plan.slices).toEqual([]);
});

test("planScenePromotion freezes the overflowed finalized prefix (header excluded)", () => {
  // rows: 3 -> maxLiveRows 2; the tail fits [blank 5, composer 6], so row2 (line 4) overflows.
  const plan = planScenePromotion(planScene(), { columns: 20, rows: 3 }, new Set());
  expect(plan.committedSectionIds).toEqual(["row1", "row2"]);
  expect(plan.liveLineStart).toBe(5);
});

test("planScenePromotion stops at the first non-finalized section (no reorder)", () => {
  // row1 still active: even though row2 is finalized and overflowed, it must not commit past row1.
  const plan = planScenePromotion(planScene({ row1Final: false }), { columns: 20, rows: 3 }, new Set());
  expect(plan.committedSectionIds).toEqual([]);
  expect(plan.liveLineStart).toBe(1);
});

test("planScenePromotion snaps the boundary down, keeping a trailing active section live", () => {
  // row1 finalized+overflowed commits; row2 active stops the prefix, so the boundary snaps
  // down to row1's end (3) rather than the raw fit boundary (5) — row2 stays fully live.
  const plan = planScenePromotion(planScene({ row2Final: false }), { columns: 20, rows: 3 }, new Set());
  expect(plan.committedSectionIds).toEqual(["row1"]);
  expect(plan.liveLineStart).toBe(3);
});

test("planScenePromotion emits slices only for newly committed sections", () => {
  const plan = planScenePromotion(planScene(), { columns: 20, rows: 3 }, new Set(["row1"]));
  expect(plan.committedSectionIds).toEqual(["row1", "row2"]);
  expect(plan.slices.map((s) => s.id)).toEqual(["row2"]);
});
