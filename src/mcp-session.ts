import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { errorMessage } from "./error-contract";
import { log } from "./log";
import {
  MCP_CLIENT_INFO,
  MCP_CONNECT_TIMEOUT_MS,
  type McpHttpServerConfig,
  type McpServerConfig,
  type McpStdioServerConfig,
  STDIO_ENV_ALLOWLIST,
} from "./mcp-contract";

function withDeadline<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    task.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

type ServerConnection = {
  client: Client;
  tools: McpTool[];
};

type SessionState = {
  connections: Map<string, ServerConnection>;
};

const sessions = new Map<string, SessionState>();

function createTransport(config: McpServerConfig, onClose: () => void) {
  if (config.type === "stdio") {
    return createStdioTransport(config, onClose);
  }
  return createHttpTransport(config, onClose);
}

function createStdioTransport(config: McpStdioServerConfig, onClose: () => void) {
  const env: Record<string, string> = {};
  for (const key of STDIO_ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  if (config.env) Object.assign(env, config.env);
  const transport = new StdioClientTransport({ command: config.command, args: config.args ?? [], env });
  transport.onclose = onClose;
  return transport;
}

function createHttpTransport(config: McpHttpServerConfig, onClose: () => void) {
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers ?? {} },
  });
  transport.onclose = onClose;
  return transport;
}

function getOrCreateSession(sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = { connections: new Map() };
    sessions.set(sessionId, state);
  }
  return state;
}

/**
 * Returns a connected Client for the given server within a session, reusing an
 * existing connection if one is alive. Reconnects automatically after a drop.
 */
export async function getOrConnectClient(
  sessionId: string,
  serverName: string,
  config: McpServerConfig,
): Promise<{ client: Client; tools: McpTool[] }> {
  const state = getOrCreateSession(sessionId);
  const existing = state.connections.get(serverName);
  if (existing) return existing;

  const client = new Client(MCP_CLIENT_INFO);
  const transport = createTransport(config, () => {
    // Remove from registry on close so the next call reconnects automatically.
    state.connections.delete(serverName);
    log.debug("mcp.session.disconnected", { session: sessionId, server: serverName });
  });

  await withDeadline(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, `mcp/${serverName}/connect`);
  const { tools } = await withDeadline(client.listTools(), MCP_CONNECT_TIMEOUT_MS, `mcp/${serverName}/listTools`);

  const connection = { client, tools };
  state.connections.set(serverName, connection);
  log.debug("mcp.session.connected", { session: sessionId, server: serverName, tools: tools.length });
  return connection;
}

/**
 * Closes all connections for a session and removes it from the registry.
 */
export async function closeMcpSession(sessionId: string): Promise<void> {
  const state = sessions.get(sessionId);
  if (!state) return;
  sessions.delete(sessionId);
  for (const [serverName, { client }] of state.connections) {
    try {
      await client.close();
    } catch (error) {
      log.warn("mcp.session.close_failed", { session: sessionId, server: serverName, error: errorMessage(error) });
    }
  }
}

/**
 * Closes all active sessions. Call on daemon shutdown.
 */
export async function closeAllMcpSessions(): Promise<void> {
  await Promise.allSettled([...sessions.keys()].map(closeMcpSession));
}
