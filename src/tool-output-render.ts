import { t, tDynamic } from "./i18n";
import type { ToolOutputPart } from "./tool-output-contract";

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

function formatMeta(meta: Record<string, unknown>): string {
  if ("added" in meta && "removed" in meta) return `(+${meta.added} -${meta.removed})`;
  return "";
}

function formatHeader(header: ResolvedHeader): string {
  const parts = [header.label];
  if (header.detail) parts.push(header.detail);
  if (header.meta) parts.push(formatMeta(header.meta));
  return parts.join(" ");
}

function formatTruncated(count: number | undefined, unit: string | undefined): string {
  if (!count) return "…";
  switch (unit) {
    case "lines":
      return `… +${t("unit.line", { count })}`;
    case "matches":
      return `… +${t("unit.match", { count })}`;
    case "files":
      return `… +${t("unit.file", { count })}`;
    default:
      return `… +${t("unit.more", { count })}`;
  }
}

function renderPart(content: ToolOutputPart): string {
  const header = resolveHeader(content);
  if (header) return formatHeader(header);

  switch (content.kind) {
    case "text":
      return content.text;
    case "diff":
      return `${content.lineNumber} ${content.marker === "add" ? "+" : content.marker === "remove" ? "-" : " "}${content.text}`;
    case "shell-output":
      return `${content.stream === "stdout" ? "out" : "err"} | ${content.text}`;
    case "no-output":
      return t("tool.content.no_output");
    case "truncated":
      return formatTruncated(content.count, content.unit);
    default:
      return "";
  }
}

function renderDiffLine(item: Extract<ToolOutputPart, { kind: "diff" }>, numWidth: number): string {
  const num = String(item.lineNumber).padStart(numWidth);
  const prefix = item.marker === "add" ? "+" : item.marker === "remove" ? "-" : " ";
  return `${num} ${prefix}${item.text}`;
}

function renderList(items: ToolOutputPart[]): string {
  const first = items[0];
  if (!first) return "";
  const header = renderPart(first);
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
      const suffix = renderPart(item).slice(2);
      return suffix ? `${diffIndent}${"⋮".padStart(numWidth)} ${suffix}` : `${diffIndent}${"⋮".padStart(numWidth)}`;
    }
    return renderPart(item);
  });
  return `${header}\n${lines.map((line) => `  ${line}`).join("\n")}`;
}

export function renderToolOutput(content: ToolOutputPart | ToolOutputPart[]): string {
  return Array.isArray(content) ? renderList(content) : renderPart(content);
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
      const incoming = renderPart(entry.content);
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
