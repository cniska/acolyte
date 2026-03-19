import type { z } from "zod";
import type { SessionContext } from "./tool-guards";
import type { ToolOutputListener } from "./tool-output-format";

export type ToolPermission = "read" | "write" | "execute" | "network";
export type ToolCategory = "read" | "search" | "write" | "execute" | "network";

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  readonly id: string;
  readonly label: string;
  readonly category: ToolCategory;
  readonly permissions: readonly ToolPermission[];
  readonly description: string;
  readonly instruction: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly execute: (input: TInput, toolCallId: string) => Promise<TOutput>;
};

export type ToolOutputBudgetEntry = { maxChars: number; maxLines: number };

export type ToolOutputBudget = {
  findFiles: ToolOutputBudgetEntry;
  searchFiles: ToolOutputBudgetEntry;
  webSearch: ToolOutputBudgetEntry;
  webFetch: ToolOutputBudgetEntry;
  read: ToolOutputBudgetEntry;
  gitStatus: ToolOutputBudgetEntry;
  gitDiff: ToolOutputBudgetEntry;
  run: ToolOutputBudgetEntry;
  edit: ToolOutputBudgetEntry;
  astEdit: ToolOutputBudgetEntry;
  scanCode: ToolOutputBudgetEntry;
  create: ToolOutputBudgetEntry;
};

export type ToolkitDeps = {
  outputBudget: ToolOutputBudget;
};

export type ToolkitInput = {
  workspace: string;
  session: SessionContext;
  onOutput: ToolOutputListener;
};

export type ToolCacheEntry = {
  result: unknown;
};

export type ToolCache = {
  isCacheable(toolName: string): boolean;
  get(toolName: string, args: Record<string, unknown>): ToolCacheEntry | undefined;
  set(toolName: string, args: Record<string, unknown>, entry: ToolCacheEntry): void;
  populateSubEntries(toolName: string, args: Record<string, unknown>, result: unknown): void;
  invalidateForWrite(toolName: string, args: Record<string, unknown>): void;
  clear(): void;
  stats(): { hits: number; misses: number; invalidations: number; evictions: number; size: number };
};

export function createTool<TInput, TOutput>(config: ToolDefinition<TInput, TOutput>): ToolDefinition<TInput, TOutput> {
  return {
    ...config,
    execute: async (input, toolCallId) => config.outputSchema.parse(await config.execute(input, toolCallId)),
  };
}
