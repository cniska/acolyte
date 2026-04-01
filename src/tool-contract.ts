import type { z } from "zod";
import type { ChecklistItem } from "./checklist-contract";
import type { ToolRunResult } from "./tool-execution";
import type { ToolOutputListener } from "./tool-output-format";
import type { SessionContext } from "./tool-session";

export type ToolCategory = "read" | "search" | "write" | "execute" | "network" | "meta";

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  readonly id: string;
  readonly toolkit: string;
  readonly category: ToolCategory;
  readonly description: string;
  readonly instruction: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly execute: (input: TInput, toolCallId: string) => Promise<ToolRunResult>;
  readonly labelKey?: string;
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

export type ChecklistListener = (event: { groupId: string; groupTitle: string; items: ChecklistItem[] }) => void;

export type ToolkitInput = {
  workspace: string;
  session: SessionContext;
  onOutput: ToolOutputListener;
  onChecklist: ChecklistListener;
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
    execute: async (input, toolCallId) => {
      const runResult = await config.execute(input, toolCallId);
      config.outputSchema.parse(runResult.result);
      return runResult;
    },
  };
}
