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

const ANSI = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[39m",
  resetDim: "\x1b[22m",
} as const;

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
      if (content.marker === "add") return `${content.lineNumber} + ${content.text}`;
      if (content.marker === "remove") return `${content.lineNumber} - ${content.text}`;
      return `${content.lineNumber}  ${content.text}`;
    }
    case "no-output":
      return t("tool.content.no_output");
    case "truncated": {
      const unitKey = content.unit === "lines" ? "unit.line" : content.unit === "matches" ? "unit.match" : "unit.more";
      return `… +${t(unitKey, { count: content.count })}`;
    }
  }
}

export function resolveToolOutputHeader(items: ToolOutput[]): { header: string; bodyStart: number } {
  const first = items[0];
  if (!first) return { header: "", bodyStart: 0 };

  switch (first.kind) {
    case "tool-header":
      return { header: first.detail ? `${first.label} ${first.detail}` : first.label, bodyStart: 1 };
    case "file-header": {
      const shown = first.targets.join(", ");
      const omitted = first.omitted && first.omitted > 0 ? `, +${first.omitted}` : "";
      return { header: `${first.label} ${shown}${omitted}`, bodyStart: 1 };
    }
    case "scope-header": {
      const needsBrackets = first.scope !== "workspace";
      const patternsDisplay = needsBrackets ? `[${first.patterns.join(", ")}]` : first.patterns.join(", ");
      const scopePrefix = first.scope === "workspace" ? "" : `${first.scope} `;
      return { header: `${first.label} ${scopePrefix}${patternsDisplay}`, bodyStart: 1 };
    }
    case "edit-header":
      return { header: `${first.label} ${first.path} (+${first.added} -${first.removed})`, bodyStart: 1 };
    default:
      return { header: "", bodyStart: 0 };
  }
}

export function renderToolOutputContent(items: ToolOutput[]): string {
  if (items.length === 0) return "";
  const { header, bodyStart } = resolveToolOutputHeader(items);
  if (!header) return items.map(renderToolOutput).join("\n");
  const body = items.slice(bodyStart).map(renderToolOutput).filter(Boolean);
  if (body.length === 0) return header;
  return `${header}\n${body.map((line) => `  ${line}`).join("\n")}`;
}

export function renderToolOutputForTerminal(content: ToolOutput, padWidth = 0): string {
  if (content.kind !== "diff") return renderToolOutput(content);
  const num = `${ANSI.dim}${String(content.lineNumber).padStart(padWidth)}${ANSI.resetDim}`;
  if (content.marker === "add") return `${num}  ${ANSI.green}${content.text}${ANSI.reset}`;
  if (content.marker === "remove") return `${num}  ${ANSI.red}${content.text}${ANSI.reset}`;
  return `${num}  ${content.text}`;
}

export type ToolOutputUpdate = {
  rendered: string;
  label?: string;
  items: ToolOutput[];
};

export function createToolOutputState(): {
  push: (entry: { toolCallId: string; content: ToolOutput }) => ToolOutputUpdate | null;
  delete: (toolCallId: string) => void;
} {
  const contentByCallId = new Map<string, ToolOutput[]>();

  return {
    push(entry) {
      const items = contentByCallId.get(entry.toolCallId) ?? [];
      const incoming = renderToolOutput(entry.content);
      const lastItem = items[items.length - 1];
      if (lastItem && renderToolOutput(lastItem) === incoming) return null;
      items.push(entry.content);
      contentByCallId.set(entry.toolCallId, items);
      const rendered = renderToolOutputContent(items);
      if (!rendered) return null;
      const firstItem = items[0];
      const label =
        firstItem && "label" in firstItem && typeof firstItem.label === "string" ? firstItem.label : undefined;
      return { rendered, label, items };
    },
    delete(toolCallId) {
      contentByCallId.delete(toolCallId);
    },
  };
}

