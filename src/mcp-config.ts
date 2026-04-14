import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type McpConfig, mcpConfigSchema } from "./mcp-contract";
import { configDir } from "./paths";

const MCP_CONFIG_FILE = "mcp.json";

function readRawConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseConfig(raw: Record<string, unknown>): McpConfig {
  const result = mcpConfigSchema.safeParse(raw);
  return result.success ? result.data : { servers: {} };
}

export function readMcpConfig(workspace: string): McpConfig {
  const userPath = join(configDir(), MCP_CONFIG_FILE);
  const projectPath = join(workspace, ".acolyte", MCP_CONFIG_FILE);

  const userRaw = readRawConfig(userPath);
  const projectRaw = readRawConfig(projectPath);

  const userConfig = parseConfig(userRaw);
  const projectConfig = parseConfig(projectRaw);

  // Project-level servers take precedence over user-level by name
  return {
    servers: { ...userConfig.servers, ...projectConfig.servers },
  };
}
