import { readJson } from "./json";
import { type McpConfig, mcpConfigSchema } from "./mcp-contract";

export function readMcpConfig(workspace: string): McpConfig {
  const raw = readJson(workspace, ".mcp.json");
  if (!raw) return { mcpServers: {} };
  const result = mcpConfigSchema.safeParse(raw);
  return result.success ? result.data : { mcpServers: {} };
}
