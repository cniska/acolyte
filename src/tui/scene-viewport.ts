import type { TerminalLine, TerminalScene, TerminalSceneSection } from "../terminal-scene-contract";

export type SceneViewportConstraints = { columns: number; rows: number };

export type PromotedSceneSlice = { id: string; lines: TerminalLine[] };

// Freeze so scrollback can never mutate after commit.
export function freezeSlice(id: string, lines: readonly TerminalLine[]): PromotedSceneSlice {
  const frozen = lines.map((line) => Object.freeze({ ...line, spans: Object.freeze([...line.spans]) }) as TerminalLine);
  return Object.freeze({ id, lines: Object.freeze(frozen) as TerminalLine[] }) as PromotedSceneSlice;
}

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

// Skips already-promoted ids to stay idempotent under StrictMode's double-invoke.
export function promoteSceneSlices(
  scene: TerminalScene,
  committedSectionIds: readonly string[],
  alreadyPromotedIds: ReadonlySet<string>,
): PromotedSceneSlice[] {
  const sections = scene.sections ?? [];
  const slices: PromotedSceneSlice[] = [];
  for (const id of committedSectionIds) {
    if (alreadyPromotedIds.has(id)) continue;
    const section = sections.find((candidate) => candidate.id === id);
    if (!section) continue;
    slices.push(freezeSlice(id, scene.lines.slice(section.lineStart, section.lineEnd)));
  }
  return slices;
}

// Decide which transcript sections freeze into scrollback this frame: the contiguous run
// of finalized sections (after the header) that have scrolled past the terminal-fit
// boundary. Two guards protect transcript order and integrity: stop at the first
// non-finalized section (a later-finalizing section must never overtake it into
// scrollback), and stop at the first section still visible in the tail (freezing a visible
// section would drop its lines). The live boundary snaps down to the committed prefix's end
// — floored at the header's end so the header never enters the live tail — so the tail may
// exceed the terminal height by one straddling section, which the renderer's freeze absorbs.
// The header itself is not committed here; it is seeded into scrollback with a segment-
// versioned id, since its scene id is a constant the append-only log would collide on.
export function planScenePromotion(
  scene: TerminalScene,
  constraints: SceneViewportConstraints,
  alreadyPromotedIds: ReadonlySet<string>,
): { liveLineStart: number; committedSectionIds: string[]; slices: PromotedSceneSlice[] } {
  const sections = scene.sections ?? [];
  const { liveLineStart: fitStart } = fitSceneViewport(scene, constraints);
  const headerEnd = sections[0]?.lineEnd ?? 0;
  const committed: TerminalSceneSection[] = [];
  for (let index = 1; index < sections.length; index++) {
    const section = sections[index];
    if (!section?.finalized || section.lineEnd > fitStart) break;
    committed.push(section);
  }
  const liveLineStart = committed.length > 0 ? (committed[committed.length - 1]?.lineEnd ?? headerEnd) : headerEnd;
  const committedSectionIds = committed.map((section) => section.id);
  return {
    liveLineStart,
    committedSectionIds,
    slices: promoteSceneSlices(scene, committedSectionIds, alreadyPromotedIds),
  };
}

export function sceneCursorPlacement(
  scene: TerminalScene,
  liveLineStart: number,
): { row: number; column: number } | null {
  if (!scene.cursor || scene.cursor.row < liveLineStart) return null;
  return { row: scene.cursor.row - liveLineStart, column: scene.cursor.column };
}
