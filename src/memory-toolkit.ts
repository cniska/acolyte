import { z } from "zod";
import { type MemoryRecord, type MemoryStore, memoryScopeSchema, scopeFromKey } from "./memory-contract";
import { bufferToEmbedding, cosineSimilarity, embedText } from "./memory-embedding";
import { addMemory, removeMemory } from "./memory-ops";
import { getDefaultMemoryStore } from "./memory-store";
import type { ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";

export async function searchMemories(
  query: string,
  options?: { scope?: "user" | "project"; limit?: number; store?: MemoryStore },
): Promise<MemoryRecord[]> {
  const store = options?.store ?? getDefaultMemoryStore();
  const limit = options?.limit ?? 10;
  const all = await store.list({ kind: "stored" });
  const filtered = options?.scope ? all.filter((r) => scopeFromKey(r.scopeKey) === options.scope) : all;
  if (filtered.length === 0) return [];

  const queryEmbedding = await embedText(query);
  if (!queryEmbedding) return filtered.slice(0, limit);

  const ids = filtered.map((r) => r.id);
  const embeddings = store.getEmbeddings(ids);

  const scored = filtered.map((record) => {
    const buf = embeddings.get(record.id);
    const score = buf ? cosineSimilarity(queryEmbedding, bufferToEmbedding(buf)) : 0;
    return { record, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.record);
}

function createMemorySearchTool(input: ToolkitInput) {
  return createTool({
    id: "memory-search",
    toolkit: "memory",
    category: "meta",
    description: "Search all memories by relevance. Returns entries ranked by semantic similarity to the query.",
    instruction:
      "Use `memory-search` to recall prior context, decisions, or facts before starting work that might overlap with previous sessions.",
    inputSchema: z.object({
      query: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
      scope: memoryScopeSchema.extract(["user", "project"]).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("memory-search"),
      results: z.array(
        z.object({
          id: z.string(),
          content: z.string(),
          scope: memoryScopeSchema.extract(["user", "project"]),
          createdAt: z.string(),
        }),
      ),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "memory-search", toolCallId, toolInput, async () => {
        const queries = Array.isArray(toolInput.query) ? toolInput.query : [toolInput.query];
        const seen = new Set<string>();
        const results: MemoryRecord[] = [];
        for (const q of queries) {
          for (const r of await searchMemories(q, { scope: toolInput.scope, limit: toolInput.limit })) {
            if (!seen.has(r.id)) {
              seen.add(r.id);
              results.push(r);
            }
          }
        }
        return {
          kind: "memory-search" as const,
          results: results.map((r) => ({
            id: r.id,
            content: r.content,
            scope: scopeFromKey(r.scopeKey),
            createdAt: r.createdAt,
          })),
        };
      });
    },
  });
}

function createMemoryAddTool(input: ToolkitInput) {
  return createTool({
    id: "memory-add",
    toolkit: "memory",
    category: "meta",
    description:
      "Store a new memory. Use project scope for workspace-specific facts and user scope for cross-project preferences.",
    instruction:
      "Use `memory-add` to persist important findings, decisions, or corrections that should survive across sessions.",
    inputSchema: z.object({
      content: z.string().min(1),
      scope: memoryScopeSchema.extract(["user", "project"]),
    }),
    outputSchema: z.object({
      kind: z.literal("memory-add"),
      id: z.string(),
      scope: memoryScopeSchema.extract(["user", "project"]),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "memory-add", toolCallId, toolInput, async () => {
        const entry = await addMemory(toolInput.content, { scope: toolInput.scope });
        return { kind: "memory-add" as const, id: entry.id, scope: entry.scope };
      });
    },
  });
}

function createMemoryRemoveTool(input: ToolkitInput) {
  return createTool({
    id: "memory-remove",
    toolkit: "memory",
    category: "meta",
    description: "Remove a memory by its ID. Use after finding stale or incorrect memories via memory-search.",
    instruction: "Use `memory-remove` to clean up outdated or incorrect memories found via `memory-search`.",
    inputSchema: z.object({
      id: z.string().min(1),
    }),
    outputSchema: z.object({
      kind: z.literal("memory-remove"),
      result: z.enum(["removed", "not_found"]),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "memory-remove", toolCallId, toolInput, async () => {
        const result = await removeMemory(toolInput.id);
        return { kind: "memory-remove" as const, result: result.kind === "removed" ? "removed" : result.kind };
      });
    },
  });
}

export function createMemoryToolkit(input: ToolkitInput) {
  return {
    memorySearch: createMemorySearchTool(input),
    memoryAdd: createMemoryAddTool(input),
    memoryRemove: createMemoryRemoveTool(input),
  };
}
