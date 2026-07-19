import { z } from "zod";
import { unreachable } from "./assert";
import { t, tDynamic } from "./i18n";
import type { ToolOutputPart } from "./tool-output-contract";
import { truncateMiddleToWidth, truncateToWidth } from "./truncate-text";

export const segmentRoleSchema = z.enum([
  "label",
  "detail",
  "meta-punct",
  "meta-add",
  "meta-remove",
  "diff-gutter",
  "diff-text",
  "dim",
  "stream-tag",
]);
export type SegmentRole = z.infer<typeof segmentRoleSchema>;

export const layoutSegmentSchema = z.object({ role: segmentRoleSchema, text: z.string() });
export type LayoutSegment = z.infer<typeof layoutSegmentSchema>;

export const layoutFillSchema = z.enum(["diff-add", "diff-remove"]);
export type LayoutFill = z.infer<typeof layoutFillSchema>;

export const layoutLineSchema = z.object({
  kind: z.enum(["header", "body"]),
  indent: z.number().int().nonnegative(),
  segments: z.array(layoutSegmentSchema),
  fill: layoutFillSchema.optional(),
});
export type LayoutLine = z.infer<typeof layoutLineSchema>;

export type ResolvedHeader = { label: string; detail?: string; meta?: Record<string, unknown> };

export function resolveHeader(content: ToolOutputPart): ResolvedHeader | null {
  switch (content.kind) {
    case "tool-header": {
      const label = tDynamic(content.labelKey);
      const detail = content.detail && content.detail !== "." ? content.detail : undefined;
      return { label, detail };
    }
    case "file-header": {
      const label = tDynamic(content.labelKey);
      const detail =
        content.count === 1 && content.targets.length === 1
          ? content.targets[0]
          : t("unit.file", { count: content.count });
      return { label, detail };
    }
    case "scope-header": {
      const label = tDynamic(content.labelKey);
      const scopeSuffix = content.scope !== "workspace" ? ` in ${content.scope}` : "";
      const detail =
        content.patterns.length === 1
          ? `${content.patterns[0]}${scopeSuffix}`
          : `${t("unit.pattern", { count: content.patterns.length })}${scopeSuffix}`;
      return { label, detail };
    }
    case "edit-header": {
      const label = tDynamic(content.labelKey);
      const path = content.path === "." ? undefined : content.path;
      return { label, detail: path, meta: { added: content.added, removed: content.removed } };
    }
    default:
      return null;
  }
}

const TRUNCATED_UNIT_KEYS: Record<string, string> = {
  lines: "unit.line",
  matches: "unit.match",
  files: "unit.file",
};

function truncatedText(count: number | undefined, unit: string | undefined): string {
  if (!count) return "…";
  const text = tDynamic(TRUNCATED_UNIT_KEYS[unit ?? ""] ?? "unit.more", { count });
  return `… +${text}`;
}

function headerSegments(header: ResolvedHeader): LayoutSegment[] {
  const segments: LayoutSegment[] = [{ role: "label", text: header.label }];
  if (header.detail) segments.push({ role: "detail", text: ` ${header.detail}` });
  const meta = header.meta;
  if (meta && "added" in meta && "removed" in meta) {
    segments.push(
      { role: "meta-punct", text: " (" },
      { role: "meta-add", text: `+${meta.added}` },
      { role: "meta-punct", text: " " },
      { role: "meta-remove", text: `-${meta.removed}` },
      { role: "meta-punct", text: ")" },
    );
  }
  return segments;
}

/** Segments for a single part rendered inline (no gutter, no indent) — the header line form. */
export function inlineSegments(part: ToolOutputPart): LayoutSegment[] {
  const header = resolveHeader(part);
  if (header) return headerSegments(header);
  switch (part.kind) {
    case "text":
      return [{ role: "dim", text: part.text }];
    case "diff": {
      const marker = part.marker === "add" ? "+" : part.marker === "remove" ? "-" : " ";
      return [{ role: "dim", text: `${part.lineNumber} ${marker}${part.text}` }];
    }
    case "shell-output":
      return [
        { role: "stream-tag", text: `${part.stream === "stdout" ? "out" : "err"} | ` },
        { role: "dim", text: part.text },
      ];
    case "no-output":
      return [{ role: "dim", text: t("tool.content.no_output") }];
    case "truncated":
      return [{ role: "dim", text: truncatedText(part.count, part.unit) }];
    case "tool-header":
    case "file-header":
    case "scope-header":
    case "edit-header":
      return [];
    default:
      return unreachable(part);
  }
}

function bodyLine(part: ToolOutputPart, numWidth: number): LayoutLine {
  switch (part.kind) {
    case "diff": {
      const num = String(part.lineNumber).padStart(numWidth);
      const marker = part.marker === "add" ? "+" : part.marker === "remove" ? "-" : " ";
      const fill: LayoutFill | undefined =
        part.marker === "add" ? "diff-add" : part.marker === "remove" ? "diff-remove" : undefined;
      return {
        kind: "body",
        indent: 2,
        segments: [
          { role: "diff-gutter", text: ` ${num} ${marker}` },
          { role: "diff-text", text: part.text },
        ],
        fill,
      };
    }
    case "truncated": {
      if (numWidth > 0) {
        const suffix = truncatedText(part.count, part.unit);
        const gutter = ` ${"⋮".padStart(numWidth)}`;
        const segments: LayoutSegment[] = [{ role: "diff-gutter", text: suffix === "…" ? gutter : `${gutter}  ` }];
        if (suffix !== "…") segments.push({ role: "dim", text: suffix.slice(2) });
        return { kind: "body", indent: 2, segments };
      }
      return { kind: "body", indent: 2, segments: [{ role: "dim", text: truncatedText(part.count, part.unit) }] };
    }
    case "shell-output":
      return {
        kind: "body",
        indent: 2,
        segments: [
          { role: "stream-tag", text: `${part.stream === "stdout" ? "out" : "err"} | ` },
          { role: "dim", text: part.text },
        ],
      };
    case "text":
      return { kind: "body", indent: 2, segments: [{ role: "dim", text: part.text }] };
    case "no-output":
      return { kind: "body", indent: 2, segments: [{ role: "dim", text: t("tool.content.no_output") }] };
    case "tool-header":
    case "file-header":
    case "scope-header":
    case "edit-header":
      return { kind: "body", indent: 2, segments: inlineSegments(part) };
    default:
      return unreachable(part);
  }
}

export function layoutToolOutput(parts: ToolOutputPart[]): LayoutLine[] {
  const [first, ...rest] = parts;
  if (!first) return [];
  const numWidth = rest.reduce(
    (max, part) => (part.kind === "diff" ? Math.max(max, String(part.lineNumber).length) : max),
    0,
  );
  const headerLine: LayoutLine = { kind: "header", indent: 0, segments: inlineSegments(first) };
  return [headerLine, ...rest.map((part) => bodyLine(part, numWidth))];
}

export function segmentsWidth(segments: LayoutSegment[]): number {
  return segments.reduce((sum, segment) => sum + Bun.stringWidth(segment.text), 0);
}

export function visibleLineWidth(line: LayoutLine): number {
  return line.indent + segmentsWidth(line.segments);
}

function fitBody(segments: LayoutSegment[], avail: number): LayoutSegment[] {
  const out: LayoutSegment[] = [];
  let used = 0;
  for (const segment of segments) {
    const width = Bun.stringWidth(segment.text);
    if (used + width <= avail) {
      out.push(segment);
      used += width;
      continue;
    }
    const remaining = avail - used;
    if (remaining > 0) out.push({ role: segment.role, text: truncateToWidth(segment.text, remaining) });
    break;
  }
  return out;
}

function fitHeader(segments: LayoutSegment[], avail: number): LayoutSegment[] {
  if (segmentsWidth(segments) <= avail) return segments;
  const detailIndex = segments.findIndex((segment) => segment.role === "detail");
  const detail = detailIndex === -1 ? undefined : segments[detailIndex];
  if (!detail) return fitBody(segments, avail);
  const detailBudget = avail - (segmentsWidth(segments) - Bun.stringWidth(detail.text));
  if (detailBudget <= 1) {
    return fitBody(
      segments.filter((_, index) => index !== detailIndex),
      avail,
    );
  }
  const content = detail.text.startsWith(" ") ? detail.text.slice(1) : detail.text;
  const out = [...segments];
  out[detailIndex] = { role: "detail", text: ` ${truncateMiddleToWidth(content, detailBudget - 1)}` };
  return out;
}

/** Truncate a line's segments to fit `width` columns; `undefined` width leaves it untouched. */
export function fitLine(line: LayoutLine, width?: number): LayoutLine {
  if (width === undefined) return line;
  const avail = Math.max(0, width - line.indent);
  const segments = line.kind === "header" ? fitHeader(line.segments, avail) : fitBody(line.segments, avail);
  return { ...line, segments };
}
