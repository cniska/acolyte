import { z } from "zod";
import { unreachable } from "./assert";
import { t, tDynamic } from "./i18n";

export const toolOutputDiffMarkerSchema = z.enum(["add", "remove", "context"]);

export const toolOutputPartSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tool-header"),
    labelKey: z.string().trim().min(1),
    detail: z.string().optional(),
  }),
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1) }),
  z.object({
    kind: z.literal("file-header"),
    labelKey: z.string().trim().min(1),
    count: z.number().int().nonnegative(),
    targets: z.array(z.string().trim().min(1)),
    omitted: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("scope-header"),
    labelKey: z.string().trim().min(1),
    scope: z.string().trim().min(1),
    patterns: z.array(z.string()),
    matches: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("edit-header"),
    labelKey: z.string().trim().min(1),
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
  z.object({
    kind: z.literal("shell-output"),
    stream: z.enum(["stdout", "stderr"]),
    text: z.string(),
  }),
  z.object({ kind: z.literal("no-output") }),
  z.object({
    kind: z.literal("truncated"),
    count: z.number().int().nonnegative().optional(),
    unit: z.string().optional(),
  }),
]);

export type ToolOutputPart = z.infer<typeof toolOutputPartSchema>;

export function renderToolOutputPart(content: ToolOutputPart): string {
  switch (content.kind) {
    case "tool-header": {
      const label = tDynamic(content.labelKey);
      return content.detail ? `${label} ${content.detail}` : label;
    }
    case "text":
      return content.text;
    case "file-header": {
      const label = tDynamic(content.labelKey);
      const shown = content.targets.join(", ");
      const omitted = content.omitted && content.omitted > 0 ? `, +${content.omitted}` : "";
      return `${label} ${shown}${omitted}`;
    }
    case "scope-header": {
      const label = tDynamic(content.labelKey);
      const isSearch = content.labelKey.includes("search");
      const patternsDisplay = isSearch ? content.patterns.map((p) => `"${p}"`).join(", ") : content.patterns.join(", ");
      const scopeSuffix = content.scope !== "workspace" ? ` in ${content.scope}` : "";
      return `${label} ${patternsDisplay}${scopeSuffix}`;
    }
    case "edit-header":
      return `${tDynamic(content.labelKey)} ${content.path} (+${content.added} -${content.removed})`;
    case "diff": {
      const prefix = content.marker === "add" ? "+" : content.marker === "remove" ? "-" : " ";
      return `${content.lineNumber} ${prefix}${content.text}`;
    }
    case "shell-output": {
      const label = content.stream === "stdout" ? "out" : "err";
      return `${label} | ${content.text}`;
    }
    case "no-output":
      return t("tool.content.no_output");
    case "truncated": {
      if (!content.count) return "…";
      const unitKey =
        content.unit === "lines"
          ? "unit.line"
          : content.unit === "matches"
            ? "unit.match"
            : content.unit === "files"
              ? "unit.file"
              : "unit.more";
      return `… +${t(unitKey, { count: content.count })}`;
    }
    default:
      return unreachable(content);
  }
}

function renderDiffLine(item: Extract<ToolOutputPart, { kind: "diff" }>, numWidth: number): string {
  const num = String(item.lineNumber).padStart(numWidth);
  const prefix = item.marker === "add" ? "+" : item.marker === "remove" ? "-" : " ";
  return `${num} ${prefix}${item.text}`;
}

export function formatToolOutput(items: ToolOutputPart[]): string {
  if (items.length === 0) return "";
  const first = items[0];
  if (!first) return "";
  const header = renderToolOutputPart(first);
  const body = items.slice(1);
  if (body.length === 0) return header;
  const numWidth = body.reduce(
    (max, item) => (item.kind === "diff" ? Math.max(max, String(item.lineNumber).length) : max),
    0,
  );
  const hasFileHeaders = numWidth > 0 && body.some((item) => item.kind === "text");
  const diffIndent = hasFileHeaders ? "  " : "";
  const lines = body.map((item) => {
    if (item.kind === "diff") return `${diffIndent}${renderDiffLine(item, numWidth)}`;
    if (item.kind === "truncated" && numWidth > 0) {
      const suffix = renderToolOutputPart(item).slice(2);
      return suffix ? `${diffIndent}${"⋮".padStart(numWidth)} ${suffix}` : `${diffIndent}${"⋮".padStart(numWidth)}`;
    }
    return renderToolOutputPart(item);
  });
  return `${header}\n${lines.map((line) => `  ${line}`).join("\n")}`;
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
      const incoming = renderToolOutputPart(entry.content);
      if (lastRenderedByCallId.get(entry.toolCallId) === incoming) return null;
      lastRenderedByCallId.set(entry.toolCallId, incoming);
      items.push(entry.content);
      contentByCallId.set(entry.toolCallId, items);
      const firstItem = items[0];
      const label =
        firstItem && "labelKey" in firstItem && typeof firstItem.labelKey === "string"
          ? tDynamic(firstItem.labelKey)
          : undefined;
      return { label, items };
    },
    delete(toolCallId) {
      contentByCallId.delete(toolCallId);
      lastRenderedByCallId.delete(toolCallId);
    },
  };
}
