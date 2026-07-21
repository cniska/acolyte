import { expect, test } from "bun:test";
import { fitSceneViewport, sceneCursorPlacement } from "./scene-viewport";

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
