import { z } from "zod";
import { compactDetail } from "./compact-text";
import { t } from "./i18n";
import { createTool, type ToolkitDeps, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import { emitResultChunks } from "./tool-output-format";
import { fetchWeb, searchWeb } from "./web-ops";

const WEB_SEARCH_MAX_RESULTS = 5;

export function webSearchStreamRows(result: string, query?: string): string {
  const normalizeQuery = (value: string, maxChars = 120): string => {
    const single = value.replace(/\s+/g, " ").trim();
    if (single.length <= maxChars) return single.replace(/\]/g, "\\]");
    return `${single.slice(0, maxChars - 1).trimEnd()}…`.replace(/\]/g, "\\]");
  };
  const lines = result
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return "";

  const noResultsMatch = lines[0]?.match(/^No web results found for:\s*(.+)$/i);
  if (noResultsMatch?.[1]) {
    return [`query=${JSON.stringify(normalizeQuery(noResultsMatch[1]))} results=0`, "(No output)"].join("\n");
  }

  const effectiveQuery = query ?? "search";
  const out: string[] = [];
  const entries: Array<{ rank: number; url?: string }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const titleMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (!titleMatch?.[1] || !titleMatch?.[2]) continue;
    const rank = Number.parseInt(titleMatch[1], 10);
    const title = titleMatch[2].trim();
    let url: string | undefined;
    const next = lines[i + 1]?.trim();
    if (next && /^https?:\/\//i.test(next)) {
      url = next;
      i += 1;
    }
    if (!url && title.startsWith("http")) url = title;
    entries.push({ rank: Number.isFinite(rank) ? rank : entries.length + 1, url });
  }

  out.push(`query=${JSON.stringify(normalizeQuery(effectiveQuery))} results=${entries.length}`);
  const visible = entries.slice(0, WEB_SEARCH_MAX_RESULTS);
  for (const entry of visible)
    out.push(`result rank=${entry.rank}${entry.url ? ` url=${JSON.stringify(entry.url)}` : ""}`);
  if (entries.length > WEB_SEARCH_MAX_RESULTS)
    out.push(`… +${t("unit.result", { count: entries.length - WEB_SEARCH_MAX_RESULTS })}`);
  if (entries.length === 0) out.push("(No output)");
  return out.join("\n");
}

function createWebSearchTool(deps: ToolkitDeps, input: ToolkitInput) {
  const { outputBudget } = deps;
  const { session, onOutput } = input;
  return createTool({
    id: "web-search",
    label: t("tool.label.web_search"),
    category: "network",
    permissions: ["network"],
    description:
      "Search the public web for recent information and return top results. Use for questions not answerable from the repo.",
    instruction: "Use `web-search` for external information lookup.",
    inputSchema: z.object({
      query: z.string().min(1),
      maxResults: z.number().int().min(1).max(10).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("web-search"),
      query: z.string().min(1),
      output: z.string(),
    }),
    execute: async (toolInput) => {
      return runTool(session, "web-search", toolInput, async (toolCallId) => {
        onOutput({
          toolName: "web-search",
          content: {
            kind: "tool-header",
            label: t("tool.label.web_search"),
            detail: `"${compactDetail(toolInput.query)}"`,
          },
          toolCallId,
        });
        const result = compactToolOutput(
          await searchWeb(toolInput.query, toolInput.maxResults ?? WEB_SEARCH_MAX_RESULTS),
          outputBudget.webSearch,
        );
        emitResultChunks("web-search", webSearchStreamRows(result, toolInput.query), onOutput, 80, toolCallId);
        return { kind: "web-search", query: toolInput.query, output: result };
      });
    },
  });
}

function createWebFetchTool(deps: ToolkitDeps, input: ToolkitInput) {
  const { outputBudget } = deps;
  const { session, onOutput } = input;
  return createTool({
    id: "web-fetch",
    label: t("tool.label.web_fetch"),
    category: "network",
    permissions: ["network"],
    description:
      "Fetch a public URL and return extracted text content. Use to read docs, API references, or linked resources by URL.",
    instruction: "Use `web-fetch` to read web pages, docs, or API references.",
    inputSchema: z.object({
      url: z.string().min(1),
      maxChars: z.number().int().min(500).max(12000).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("web-fetch"),
      url: z.string().min(1),
      output: z.string(),
    }),
    execute: async (toolInput) => {
      return runTool(session, "web-fetch", toolInput, async (toolCallId) => {
        onOutput({
          toolName: "web-fetch",
          content: { kind: "tool-header", label: t("tool.label.web_fetch"), detail: toolInput.url },
          toolCallId,
        });
        const result = compactToolOutput(
          await fetchWeb(toolInput.url, toolInput.maxChars ?? 5000),
          outputBudget.webFetch,
        );
        return { kind: "web-fetch", url: toolInput.url, output: result };
      });
    },
  });
}

export function createWebToolkit(deps: ToolkitDeps, input: ToolkitInput) {
  return {
    webSearch: createWebSearchTool(deps, input),
    webFetch: createWebFetchTool(deps, input),
  };
}
