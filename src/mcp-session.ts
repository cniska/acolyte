import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import { errorMessage } from "./error-contract";
import { log } from "./log";
import { MCP_CLIENT_INFO, MCP_CONNECT_TIMEOUT_MS, type McpServerConfig } from "./mcp-contract";
import { createMcpTransport } from "./mcp-transport";

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
  const transport = createMcpTransport(config, () => {
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
