import { z } from "zod";
import type { ChecklistItem } from "./checklist-contract";
import { log } from "./log";
import type { RunToolResult } from "./tool-execution";
import type { ToolOutputListener } from "./tool-output-format";
import type { SessionContext } from "./tool-session";

export type ToolCategory = "read" | "search" | "write" | "execute" | "network" | "meta";

const OUTPUT_SAFETY_CAP = 500_000;

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  readonly id: string;
  readonly toolkit: string;
  readonly category: ToolCategory;
  readonly description: string;
  readonly instruction: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: z.ZodType<TOutput>;
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
  invalidateForWrite(toolName: string, args: Record<string, unknown>): void;
  clear(): void;
  stats(): { hits: number; misses: number; invalidations: number; evictions: number; size: number };
};

type CreateToolConfig<TInput, TOutput> = Omit<ToolDefinition<TInput, TOutput>, "inputSchema"> & {
  inputSchema: z.ZodType<TInput> | Record<string, unknown>;
};

function isZodSchema(s: unknown): s is z.ZodType {
  return typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).safeParse === "function";
}

function toJsonSchema(schema: z.ZodType | Record<string, unknown>): Record<string, unknown> {
  if (!isZodSchema(schema)) return schema;
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
}

export function createTool<TInput, TOutput>(
  config: CreateToolConfig<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> {
  const inputParser = isZodSchema(config.inputSchema) ? config.inputSchema : undefined;
  return {
    ...config,
    inputSchema: toJsonSchema(config.inputSchema),
    execute: async (input, toolCallId) => {
      const parsedInput = inputParser ? (inputParser.parse(input) as TInput) : input;
      const runResult = await config.execute(parsedInput, toolCallId);
      let parsed = config.outputSchema.parse(runResult.result);
      if (parsed && typeof parsed === "object" && "output" in parsed) {
        const output = (parsed as Record<string, unknown>).output;
        if (typeof output === "string" && output.length > OUTPUT_SAFETY_CAP) {
          log.warn("tool output truncated", { chars: output.length, cap: OUTPUT_SAFETY_CAP });
          parsed = { ...parsed, output: output.slice(0, OUTPUT_SAFETY_CAP) };
        }
      }
      return { ...runResult, result: parsed };
    },
  };
}
