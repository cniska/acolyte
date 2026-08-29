import type { ToolOutputPart, ToolOutputSurface } from "./tool-output-contract";
import { fitLine, inlineSegments, type LayoutLine, layoutToolOutput, resolveHeader } from "./tool-output-layout";
import { OUTPUT_WINDOW_ROWS } from "./tool-policy";

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
  /** Everything to render: the parts the call keeps, followed by a running tool's live tail. */
  items: ToolOutputPart[];
};

export function createToolOutputState(options: { surface: ToolOutputSurface }): {
  push: (entry: { toolCallId: string; content: ToolOutputPart; transient?: boolean }) => ToolOutputUpdate | null;
  delete: (toolCallId: string) => void;
} {
  const keptByCallId = new Map<string, ToolOutputPart[]>();
  const liveByCallId = new Map<string, ToolOutputPart[]>();

  /** The last `rows` content rows of `body`, headed by what the window left out. The line saying so
   *  is not content, so it rides along without spending a row — a tail with nothing above it would
   *  otherwise read as the whole output. */
  function lastContentRows(body: ToolOutputPart[], rows: number): ToolOutputPart[] {
    let budget = rows;
    const kept: ToolOutputPart[] = [];
    let index = body.length - 1;
    for (; index >= 0 && budget > 0; index -= 1) {
      const part = body[index];
      if (!part) continue;
      if (part.kind !== "truncated") budget -= 1;
      kept.push(part);
    }
    kept.reverse();
    let dropped = 0;
    for (let behind = 0; behind <= index; behind += 1) {
      const part = body[behind];
      if (!part) continue;
      dropped += part.kind === "truncated" ? (part.count ?? 0) : 1;
    }
    if (dropped === 0) return kept;
    return [{ kind: "truncated", count: dropped, unit: "lines" }, ...kept];
  }

  /** A stream surface cannot revise what it printed, so it renders every part instead. */
  function windowed(parts: ToolOutputPart[]): ToolOutputPart[] {
    if (options.surface === "stream") return parts;
    const [header, ...body] = parts;
    // A mutation is the one output that exists nowhere else: the workspace holds the state a change
    // produced, never the change, and the next edit to the same file takes even that away.
    if (!header || header.kind === "edit-header") return parts;
    return [header, ...lastContentRows(body, OUTPUT_WINDOW_ROWS)];
  }

  function update(parts: ToolOutputPart[]): ToolOutputUpdate {
    const label = parts[0] ? resolveHeader(parts[0])?.label : undefined;
    return { label, items: parts };
  }

  return {
    push(entry) {
      const kept = keptByCallId.get(entry.toolCallId) ?? [];
      if (entry.transient && options.surface === "stream") return null;
      if (entry.transient) {
        const live = liveByCallId.get(entry.toolCallId) ?? [];
        live.push(entry.content);
        liveByCallId.set(entry.toolCallId, lastContentRows(live, OUTPUT_WINDOW_ROWS));
      } else {
        // A call has one header. A tool that only learns what its header says by doing the work
        // refines it in place, so the row it placed on arrival is the row that stays.
        const isHeader = resolveHeader(entry.content) !== null;
        if (isHeader && kept[0] && resolveHeader(kept[0]) !== null) kept[0] = entry.content;
        else kept.push(entry.content);
        keptByCallId.set(entry.toolCallId, kept);
        liveByCallId.delete(entry.toolCallId);
      }
      return update(windowed([...kept, ...(liveByCallId.get(entry.toolCallId) ?? [])]));
    },
    delete(toolCallId) {
      keptByCallId.delete(toolCallId);
      liveByCallId.delete(toolCallId);
    },
  };
}
