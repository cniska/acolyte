import type { z } from "zod";

export type ToolPermission = "read" | "write" | "execute" | "network";

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  readonly id: string;
  readonly label: string;
  readonly permissions: readonly ToolPermission[];
  readonly description: string;
  readonly instruction: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly execute: (input: TInput) => Promise<TOutput>;
};

export function createTool<TInput, TOutput>(config: ToolDefinition<TInput, TOutput>): ToolDefinition<TInput, TOutput> {
  return {
    ...config,
    execute: async (input) => config.outputSchema.parse(await config.execute(input)),
  };
}
