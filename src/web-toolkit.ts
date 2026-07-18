import { z } from "zod";
import { createTool, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { emitParts, webSearchSummaryParts } from "./tool-output-format";
import { truncateText } from "./truncate-text";
import { fetchWeb, searchWeb } from "./web-ops";

const WEB_SEARCH_MAX_RESULTS = 5;

function createWebSearchTool(input: ToolkitInput) {
  return createTool({
    id: "web-search",
    toolkit: "web",
    category: "network",
    description:
      "Search the public web for recent information and return top results. Use for questions not answerable from the repo.",
    instruction: "Use `web-search` for external information not available in the repository.",
    inputSchema: z.object({
      query: z.string().min(1),
      maxResults: z.number().int().min(1).max(10).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("web-search"),
      query: z.string().min(1),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "web-search", toolCallId, toolInput, async (callId) => {
        input.onOutput({
          toolName: "web-search",
          content: {
            kind: "tool-header",
            labelKey: "tool.label.web_search",
            detail: `"${truncateText(toolInput.query)}"`,
          },
          toolCallId: callId,
        });
        const result = await searchWeb(toolInput.query, toolInput.maxResults ?? WEB_SEARCH_MAX_RESULTS);
        emitParts(webSearchSummaryParts(result), "web-search", input.onOutput, callId);
        return { kind: "web-search" as const, query: toolInput.query, output: result };
      });
    },
  });
}

function createWebFetchTool(input: ToolkitInput) {
  return createTool({
    id: "web-fetch",
    toolkit: "web",
    category: "network",
    description:
      "Fetch a public URL and return extracted text content. Use to read docs, API references, or linked resources by URL.",
    instruction: "Use `web-fetch` to read specific URLs (docs, API refs, linked resources).",
    inputSchema: z.object({
      url: z.string().min(1),
      maxChars: z.number().int().min(500).max(12000).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("web-fetch"),
      url: z.string().min(1),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "web-fetch", toolCallId, toolInput, async (callId) => {
        input.onOutput({
          toolName: "web-fetch",
          content: { kind: "tool-header", labelKey: "tool.label.web_fetch", detail: toolInput.url },
          toolCallId: callId,
        });
        const result = await fetchWeb(toolInput.url, toolInput.maxChars ?? 5000);
        return { kind: "web-fetch" as const, url: toolInput.url, output: result };
      });
    },
  });
}

export function createWebToolkit(input: ToolkitInput) {
  return {
    webSearch: createWebSearchTool(input),
    webFetch: createWebFetchTool(input),
  };
}
