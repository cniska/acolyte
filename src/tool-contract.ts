import type { z } from "zod";

export type ToolDefinition<TInput = unknown> = {
  readonly id: string;
  readonly description: string;
  readonly instruction: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly execute: (input: TInput) => Promise<{ result: string }>;
};

export function createTool<TInput>(config: ToolDefinition<TInput>): ToolDefinition<TInput> {
  return config;
}
