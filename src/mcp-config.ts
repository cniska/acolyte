import { type McpConfig, mcpConfigSchema } from "./mcp-contract";
import { configDir } from "./paths";
import { readJson } from "./workspace-detectors";

function parseConfig(raw: Record<string, unknown> | null): McpConfig {
  if (!raw) return { mcpServers: {} };
  const result = mcpConfigSchema.safeParse(raw);
  return result.success ? result.data : { mcpServers: {} };
}

export function readMcpConfig(workspace: string): McpConfig {
  const userConfig = parseConfig(readJson(configDir(), "mcp.json"));
  const projectConfig = parseConfig(readJson(workspace, ".mcp.json"));

  // Project-level servers take precedence over user-level by name
  return {
    mcpServers: { ...userConfig.mcpServers, ...projectConfig.mcpServers },
  };
}
