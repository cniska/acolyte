import { z } from "zod";
import { t } from "./i18n";

export const toolOutputDiffMarkerSchema = z.enum(["add", "remove", "context"]);

export const toolOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tool-header"),
    label: z.string().trim().min(1),
    detail: z.string().optional(),
  }),
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1) }),
  z.object({
    kind: z.literal("file-header"),
    label: z.string().trim().min(1),
    count: z.number().int().nonnegative(),
    targets: z.array(z.string().trim().min(1)),
    omitted: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("scope-header"),
    label: z.string().trim().min(1),
    scope: z.string().trim().min(1),
    patterns: z.array(z.string()),
    matches: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("edit-header"),
    label: z.string().trim().min(1),
    path: z.string().trim().min(1),
    files: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("diff"),
    marker: toolOutputDiffMarkerSchema,
    lineNumber: z.number().int().positive(),
    text: z.string(),
  }),
  z.object({ kind: z.literal("no-output") }),
  z.object({
    kind: z.literal("truncated"),
    count: z.number().int().nonnegative(),
    unit: z.string().optional(),
  }),
]);

export type ToolOutput = z.infer<typeof toolOutputSchema>;

export function renderToolOutput(content: ToolOutput): string {
  switch (content.kind) {
    case "tool-header":
      return content.detail ? `${content.label} ${content.detail}` : content.label;
    case "text":
      return content.text;
    case "file-header": {
      const shown = content.targets.join(", ");
      const omitted = content.omitted && content.omitted > 0 ? `, +${content.omitted}` : "";
      return `${content.label} ${shown}${omitted}`;
    }
    case "scope-header": {
      const needsBrackets = content.scope !== "workspace";
      const patternsDisplay = needsBrackets ? `[${content.patterns.join(", ")}]` : content.patterns.join(", ");
      const scopePrefix = content.scope === "workspace" ? "" : `${content.scope} `;
      return `${content.label} ${scopePrefix}${patternsDisplay}`;
    }
    case "edit-header":
      return `${content.label} ${content.path} (+${content.added} -${content.removed})`;
    case "diff": {
      const prefix = content.marker === "add" ? "+" : content.marker === "remove" ? "-" : " ";
      return `${content.lineNumber} ${prefix} ${content.text}`;
    }
    case "no-output":
      return t("tool.content.no_output");
    case "truncated": {
      const unitKey = content.unit === "lines" ? "unit.line" : content.unit === "matches" ? "unit.match" : "unit.more";
      return `… +${t(unitKey, { count: content.count })}`;
    }
  }
}

export function formatToolOutput(items: ToolOutput[]): string {
  if (items.length === 0) return "";
  const header = renderToolOutput(items[0]!);
  const body = items.slice(1).map(renderToolOutput).filter(Boolean);
  if (body.length === 0) return header;
  return `${header}\n${body.map((line) => `  ${line}`).join("\n")}`;
}


export type ToolOutputUpdate = {
  label?: string;
  items: ToolOutput[];
};

export function createToolOutputState(): {
  push: (entry: { toolCallId: string; content: ToolOutput }) => ToolOutputUpdate | null;
  delete: (toolCallId: string) => void;
} {
  const contentByCallId = new Map<string, ToolOutput[]>();
  const lastRenderedByCallId = new Map<string, string>();

  return {
    push(entry) {
      const items = contentByCallId.get(entry.toolCallId) ?? [];
      const incoming = renderToolOutput(entry.content);
      if (lastRenderedByCallId.get(entry.toolCallId) === incoming) return null;
      lastRenderedByCallId.set(entry.toolCallId, incoming);
      items.push(entry.content);
      contentByCallId.set(entry.toolCallId, items);
      const firstItem = items[0];
      const label =
        firstItem && "label" in firstItem && typeof firstItem.label === "string" ? firstItem.label : undefined;
      return { label, items };
    },
    delete(toolCallId) {
      contentByCallId.delete(toolCallId);
      lastRenderedByCallId.delete(toolCallId);
    },
  };
}

