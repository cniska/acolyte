import { z } from "zod";
import { resolveCliVersion } from "./cli-version";
import { readJson } from "./json";

export const MCP_CLIENT_INFO = { name: "acolyte", version: resolveCliVersion() };
export const MCP_CONNECT_TIMEOUT_MS = 10_000;
export const STDIO_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "SHELL",
  "TERM",
  "USER",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "XDG_RUNTIME_DIR",
] as const;

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

export function readMcpConfig(workspace: string): McpConfig {
  const raw = readJson(workspace, ".mcp.json");
  if (!raw) return { mcpServers: {} };
  const result = mcpConfigSchema.safeParse(raw);
  return result.success ? result.data : { mcpServers: {} };
}
