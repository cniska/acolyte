import type { z } from "zod";

export type ToolDefinition<TInput = unknown> = {
  readonly id: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly execute: (input: TInput, ...rest: unknown[]) => Promise<{ result: string }>;
};

export function createTool<TInput>(config: ToolDefinition<TInput>): ToolDefinition<TInput> {
  return config;
}
