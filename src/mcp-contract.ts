import { z } from "zod";

export const mcpStdioServerSchema = z.object({
  type: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const mcpHttpServerSchema = z.object({
  type: z.literal("http"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const mcpServerSchema = z.discriminatedUnion("type", [mcpStdioServerSchema, mcpHttpServerSchema]);
export type McpServerConfig = z.infer<typeof mcpServerSchema>;
export type McpStdioServerConfig = z.infer<typeof mcpStdioServerSchema>;
export type McpHttpServerConfig = z.infer<typeof mcpHttpServerSchema>;

export const mcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerSchema).default({}),
});
export type McpConfig = z.infer<typeof mcpConfigSchema>;
