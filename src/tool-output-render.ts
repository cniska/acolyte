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
  items: ToolOutputPart[];
};

export function createToolOutputState(): {
  push: (entry: { toolCallId: string; content: ToolOutputPart }) => ToolOutputUpdate | null;
  delete: (toolCallId: string) => void;
} {
  const contentByCallId = new Map<string, ToolOutputPart[]>();
  const lastRenderedByCallId = new Map<string, string>();

  return {
    push(entry) {
      const items = contentByCallId.get(entry.toolCallId) ?? [];
      const incoming = serializePart(entry.content);
      if (lastRenderedByCallId.get(entry.toolCallId) === incoming) return null;
      lastRenderedByCallId.set(entry.toolCallId, incoming);
      items.push(entry.content);
      contentByCallId.set(entry.toolCallId, items);
      const label = items[0] ? resolveHeader(items[0])?.label : undefined;
      return { label, items };
    },
    delete(toolCallId) {
      contentByCallId.delete(toolCallId);
      lastRenderedByCallId.delete(toolCallId);
    },
  };
}
