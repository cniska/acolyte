import type { TerminalScene } from "../terminal-scene-contract";

export type SceneViewportConstraints = { columns: number; rows: number };

function lineRows(scene: TerminalScene, lineIndex: number, columns: number): number {
  const text = scene.lines[lineIndex]?.spans.map((span) => span.text).join("") ?? "";
  const visible = Bun.stringWidth(text);
  return visible === 0 ? 1 : Math.ceil(visible / columns);
}

export function fitSceneViewport(
  scene: TerminalScene,
  constraints: SceneViewportConstraints,
): {
  liveLineStart: number;
  committedSectionIds: string[];
} {
  const maxLiveRows = Math.max(0, constraints.rows - 1);
  let rows = 0;
  let liveLineStart = scene.lines.length;
  for (let index = scene.lines.length - 1; index >= 0; index--) {
    const next = lineRows(scene, index, constraints.columns);
    if (rows + next > maxLiveRows) break;
    rows += next;
    liveLineStart = index;
  }
  const committedSectionIds = (scene.sections ?? [])
    .filter((section) => section.finalized && section.lineEnd <= liveLineStart)
    .map((section) => section.id);
  return { liveLineStart, committedSectionIds };
}

export function sceneCursorPlacement(
  scene: TerminalScene,
  liveLineStart: number,
): { row: number; column: number } | null {
  if (!scene.cursor || scene.cursor.row < liveLineStart) return null;
  return { row: scene.cursor.row - liveLineStart, column: scene.cursor.column };
}
