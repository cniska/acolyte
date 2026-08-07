import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type McpServerConfig, STDIO_ENV_ALLOWLIST } from "./mcp-contract";

function resolveStdioEnv(config: Extract<McpServerConfig, { type: "stdio" }>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of STDIO_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (config.env) Object.assign(env, config.env);
  return env;
}

/** The one place a server config becomes a live transport, so session and ephemeral connections launch identically. */
export function createMcpTransport(
  config: McpServerConfig,
  onClose?: () => void,
): StdioClientTransport | StreamableHTTPClientTransport {
  const transport =
    config.type === "stdio"
      ? new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: resolveStdioEnv(config),
          ...(config.cwd ? { cwd: config.cwd } : {}),
        })
      : new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {} } });
  if (onClose) transport.onclose = onClose;
  return transport;
}
