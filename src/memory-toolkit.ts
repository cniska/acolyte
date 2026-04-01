import { z } from "zod";
import { type MemoryEntry, memoryScopeSchema } from "./memory-contract";
import { cosineSimilarity, embedText } from "./memory-embedding";
import { addMemory, listMemories, removeMemory } from "./memory-ops";
import type { ToolkitDeps, ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";

const memorySearchInputSchema = z.object({
  query: z.string().min(1),
  scope: memoryScopeSchema.extract(["user", "project"]).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const memoryResultSchema = z.object({
  id: z.string(),
  content: z.string(),
  scope: memoryScopeSchema.extract(["user", "project"]),
  createdAt: z.string(),
});

const memorySearchOutputSchema = z.object({
  kind: z.literal("memory-search"),
  results: z.array(memoryResultSchema),
});

const memoryAddInputSchema = z.object({
  content: z.string().min(1),
  scope: memoryScopeSchema.extract(["user", "project"]),
});

const memoryAddOutputSchema = z.object({
  kind: z.literal("memory-add"),
  id: z.string(),
  scope: z.string(),
});

const memoryRemoveInputSchema = z.object({
  id: z.string().min(1),
});

const memoryRemoveOutputSchema = z.object({
  kind: z.literal("memory-remove"),
  result: z.enum(["removed", "not_found", "ambiguous"]),
});

export async function rankByRelevance(entries: MemoryEntry[], query: string, limit: number): Promise<MemoryEntry[]> {
  const queryEmbedding = await embedText(query);
  if (!queryEmbedding) return entries.slice(0, limit);

  const scored = await Promise.all(
    entries.map(async (entry) => {
      const entryEmbedding = await embedText(entry.content);
      const score = entryEmbedding ? cosineSimilarity(queryEmbedding, entryEmbedding) : 0;
      return { entry, score };
    }),
  );
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

function createMemorySearchTool(_deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "memory-search",
    toolkit: "memory",
    labelKey: "tool.label.memory_search",
    category: "meta",
    description:
      "Search stored memories by relevance. Returns matching entries ranked by semantic similarity to the query.",
    instruction:
      "Use `memory-search` to recall prior context, decisions, or facts before starting work that might overlap with previous sessions.",
    inputSchema: memorySearchInputSchema,
    outputSchema: memorySearchOutputSchema,
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "memory-search", toolCallId, toolInput, async () => {
        const scope = toolInput.scope;
        const limit = toolInput.limit ?? 10;
        const entries = await listMemories({ scope });
        const ranked = await rankByRelevance(entries, toolInput.query, limit);
        return {
          kind: "memory-search" as const,
          results: ranked.map((e) => ({ id: e.id, content: e.content, scope: e.scope, createdAt: e.createdAt })),
        };
      });
    },
  });
}

function createMemoryAddTool(_deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "memory-add",
    toolkit: "memory",
    labelKey: "tool.label.memory_add",
    category: "meta",
    description:
      "Store a new memory. Use project scope for workspace-specific facts and user scope for cross-project preferences.",
    instruction:
      "Use `memory-add` to persist important findings, decisions, or corrections that should survive across sessions.",
    inputSchema: memoryAddInputSchema,
    outputSchema: memoryAddOutputSchema,
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "memory-add", toolCallId, toolInput, async () => {
        const entry = await addMemory(toolInput.content, { scope: toolInput.scope });
        return { kind: "memory-add" as const, id: entry.id, scope: entry.scope };
      });
    },
  });
}

function createMemoryRemoveTool(_deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "memory-remove",
    toolkit: "memory",
    labelKey: "tool.label.memory_remove",
    category: "meta",
    description: "Remove a memory by its ID. Use after finding stale or incorrect memories via memory-search.",
    instruction: "Use `memory-remove` to clean up outdated or incorrect memories found via `memory-search`.",
    inputSchema: memoryRemoveInputSchema,
    outputSchema: memoryRemoveOutputSchema,
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "memory-remove", toolCallId, toolInput, async () => {
        const result = await removeMemory(toolInput.id);
        return { kind: "memory-remove" as const, result: result.kind === "removed" ? "removed" : result.kind };
      });
    },
  });
}

export function createMemoryToolkit(deps: ToolkitDeps, input: ToolkitInput) {
  return {
    memorySearch: createMemorySearchTool(deps, input),
    memoryAdd: createMemoryAddTool(deps, input),
    memoryRemove: createMemoryRemoveTool(deps, input),
  };
}
