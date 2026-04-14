import type { z } from "zod";
import type { ChecklistItem } from "./checklist-contract";
import type { RunToolResult } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import type { ToolOutputListener } from "./tool-output-format";
import type { SessionContext } from "./tool-session";

export type ToolCategory = "read" | "search" | "write" | "execute" | "network" | "meta";

export type ToolOutputBudget = { maxChars: number; maxLines: number };

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  readonly id: string;
  readonly toolkit: string;
  readonly category: ToolCategory;
  readonly description: string;
  readonly instruction: string;
  readonly inputSchema: z.ZodType<TInput>;
  /** Raw JSON Schema to send to the model instead of converting inputSchema via z.toJSONSchema. Used by MCP tools that already have a native JSON Schema. */
  readonly rawInputSchema?: Record<string, unknown>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly outputBudget?: ToolOutputBudget;
  readonly execute: (input: TInput, toolCallId: string) => Promise<RunToolResult<TOutput>>;
};

export type ChecklistListener = (event: { groupId: string; groupTitle: string; items: ChecklistItem[] }) => void;

export type ToolkitInput = {
  workspace: string;
  session: SessionContext;
  sessionId?: string;
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
      const parsed = config.outputSchema.parse(runResult.result);
      if (config.outputBudget && parsed && typeof parsed === "object" && "output" in parsed) {
        const record = parsed as Record<string, unknown>;
        if (typeof record.output === "string") {
          record.output = compactToolOutput(record.output, config.outputBudget);
        }
      }
      return { ...runResult, result: parsed };
    },
  };
}
