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
    count: z.number().int().nonnegative(),
    targets: z.array(z.string().trim().min(1)),
    omitted: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("scope-header"),
    scope: z.string().trim().min(1),
    patterns: z.array(z.string()),
    matches: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("edit-header"),
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
      const omitted = content.omitted && content.omitted > 0 ? ` omitted=${content.omitted}` : "";
      return `paths=${content.count} targets=[${shown}]${omitted}`;
    }
    case "scope-header": {
      const patternToken = content.patterns.length > 0 ? `[${content.patterns.join(", ")}]` : "[]";
      return `scope=${content.scope} patterns=${patternToken} matches=${content.matches}`;
    }
    case "edit-header":
      return `path=${content.path} files=${content.files} added=${content.added} removed=${content.removed}`;
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
  if (!first || first.kind !== "tool-header") return { header: "", bodyStart: 0 };

  const label = first.label;
  let header = first.detail ? `${label} ${first.detail}` : label;
  let bodyStart = 1;

  const second = items[1];
  if (second?.kind === "file-header") {
    const shown = second.targets.join(", ");
    const omitted = second.omitted && second.omitted > 0 ? `, +${second.omitted}` : "";
    header = `${label} ${shown}${omitted}`;
    bodyStart = 2;
  } else if (second?.kind === "scope-header") {
    const needsBrackets = second.scope !== "workspace";
    const patternsDisplay = needsBrackets ? `[${second.patterns.join(", ")}]` : second.patterns.join(", ");
    const scopePrefix = second.scope === "workspace" ? "" : `${second.scope} `;
    header = `${label} ${scopePrefix}${patternsDisplay}`;
    bodyStart = 2;
  } else if (second?.kind === "edit-header") {
    header = `${label} ${renderToolOutput(second)}`;
    bodyStart = 2;
  }

  return { header, bodyStart };
}

export function renderToolOutputContent(items: ToolOutput[]): string {
  if (items.length === 0) return "";
  const { header, bodyStart } = resolveToolOutputHeader(items);
  if (!header) return items.map(renderToolOutput).join("\n");
  const body = items.slice(bodyStart).map(renderToolOutput).filter(Boolean);
  if (body.length === 0) return header;
  return `${header}\n${body.join("\n")}`;
}

export function renderToolOutputForTerminal(content: ToolOutput, padWidth = 0): string {
  if (content.kind !== "diff") return renderToolOutput(content);
  const num = `${ANSI.dim}${String(content.lineNumber).padStart(padWidth)}${ANSI.resetDim}`;
  if (content.marker === "add") return `${num}  ${ANSI.green}${content.text}${ANSI.reset}`;
  if (content.marker === "remove") return `${num}  ${ANSI.red}${content.text}${ANSI.reset}`;
  return `${num}  ${content.text}`;
}
