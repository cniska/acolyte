import type { ChatRow } from "./chat-contract";
import { palette } from "./palette";

const MARKERS: Record<ChatRow["kind"], string> = {
  user: "❯",
  assistant: "•",
  tool: "•",
  status: "•",
  task: "•",
  system: " ",
};

export function rowMarker(row: ChatRow): { glyph: string; color?: string } {
  const color = row.style?.markerColor ?? (row.kind === "assistant" ? palette.text : undefined);
  return { glyph: MARKERS[row.kind], color };
}
