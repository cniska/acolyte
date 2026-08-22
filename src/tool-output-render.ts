import type { ToolOutputPart } from "./tool-output-contract";
import { fitLine, inlineSegments, type LayoutLine, layoutToolOutput, resolveHeader } from "./tool-output-layout";

function serializeLine(line: LayoutLine, width?: number): string {
  const fitted = fitLine(line, width);
  return " ".repeat(fitted.indent) + fitted.segments.map((segment) => segment.text).join("");
}

function serializePart(part: ToolOutputPart): string {
  return inlineSegments(part)
    .map((segment) => segment.text)
    .join("");
}

export function renderToolOutput(content: ToolOutputPart | ToolOutputPart[], width?: number): string {
  if (!Array.isArray(content)) return serializePart(content);
  return layoutToolOutput(content)
    .map((line) => serializeLine(line, width))
    .join("\n");
}

export type ToolOutputUpdate = {
  label?: string;
  /** Everything to render, settled parts followed by the live tail. */
  items: ToolOutputPart[];
};

/** Rows of a still-running tool's output kept on screen. A settled part replaces them,
 *  so a command that never settles leaves its last rows visible instead of nothing. */
export const LIVE_TAIL_ROWS = 4;

/** `keepTransient: false` drops live parts entirely, for a renderer that writes to a stream
 *  and cannot take a row back once printed. */
export function createToolOutputState(options?: { keepTransient?: boolean }): {
  push: (entry: { toolCallId: string; content: ToolOutputPart; transient?: boolean }) => ToolOutputUpdate | null;
  delete: (toolCallId: string) => void;
} {
  const keepTransient = options?.keepTransient !== false;
  const settledByCallId = new Map<string, ToolOutputPart[]>();
  const liveByCallId = new Map<string, ToolOutputPart[]>();
  const lastRenderedByCallId = new Map<string, string>();

  return {
    push(entry) {
      const settled = settledByCallId.get(entry.toolCallId) ?? [];
      if (entry.transient && !keepTransient) return null;
      if (entry.transient) {
        const live = liveByCallId.get(entry.toolCallId) ?? [];
        live.push(entry.content);
        while (live.length > LIVE_TAIL_ROWS) live.shift();
        liveByCallId.set(entry.toolCallId, live);
      } else {
        const incoming = serializePart(entry.content);
        if (lastRenderedByCallId.get(entry.toolCallId) === incoming) return null;
        lastRenderedByCallId.set(entry.toolCallId, incoming);
        settled.push(entry.content);
        settledByCallId.set(entry.toolCallId, settled);
        liveByCallId.delete(entry.toolCallId);
      }
      const items = [...settled, ...(liveByCallId.get(entry.toolCallId) ?? [])];
      const label = items[0] ? resolveHeader(items[0])?.label : undefined;
      return { label, items };
    },
    delete(toolCallId) {
      settledByCallId.delete(toolCallId);
      liveByCallId.delete(toolCallId);
      lastRenderedByCallId.delete(toolCallId);
    },
  };
}
