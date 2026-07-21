import { type ChatRow, isToolOutput, type RowOutcome } from "./chat-contract";
import { palette } from "./palette";

const OUTCOME_COLORS: Record<RowOutcome, string> = {
  success: palette.success,
  error: palette.error,
  cancelled: palette.cancelled,
};

const MARKERS: Record<ChatRow["kind"], string> = {
  user: "❯",
  assistant: "•",
  tool: "•",
  status: "•",
  task: "•",
  system: " ",
};

const SKILL_STATE_MARKERS = {
  on: { glyph: "◉", color: palette.brand },
  off: { glyph: "○", color: palette.dim },
} as const;

function skillStateMarker(row: ChatRow): { glyph: string; color: string } | undefined {
  if (row.kind !== "tool" || !isToolOutput(row.content)) return undefined;
  const first = row.content.parts[0];
  if (first?.kind !== "tool-header" || !first.state) return undefined;
  return SKILL_STATE_MARKERS[first.state];
}

export function rowMarker(row: ChatRow): { glyph: string; color?: string } {
  const skillMarker = skillStateMarker(row);
  if (skillMarker) return skillMarker;
  const color =
    (row.style?.outcome && OUTCOME_COLORS[row.style.outcome]) ??
    row.style?.markerColor ??
    (row.kind === "assistant" ? palette.text : undefined);
  return { glyph: MARKERS[row.kind], color };
}
