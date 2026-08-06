import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  CallToolResultSchema,
  type CompatibilityCallToolResultSchema,
  type Tool as McpTool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { errorMessage } from "./error-contract";
import { log } from "./log";
import {
  MCP_CLIENT_INFO,
  MCP_CONNECT_TIMEOUT_MS,
  type McpHttpServerConfig,
  type McpServerConfig,
  readMcpConfig,
} from "./mcp-contract";
import { getOrConnectClient } from "./mcp-session";
import { createMcpTransport } from "./mcp-transport";
import { collectPluginMcpServers, ensurePluginDataDirs, loadPlugins } from "./plugin-ops";
import type { SessionContext } from "./tool-contract";
import { createTool, type ToolDefinition } from "./tool-contract";
import { runTool } from "./tool-execution";

const MCP_DESCRIPTION_MAX_CHARS = 512;

export type McpToolListing = {
  serverName: string;
  config: McpServerConfig;
  tools: McpTool[];
};

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

export function isInsecureRemoteHttp(config: McpServerConfig): boolean {
  if (config.type !== "http") return false;
  const url = new URL(config.url);
  if (url.protocol === "https:") return false;
  const host = url.hostname;
  return host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && host !== "[::1]";
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — stripping control chars from untrusted MCP descriptions
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function sanitizeDescription(raw: string | undefined, fallback: string): string {
  const text = (raw ?? fallback).replace(CONTROL_CHAR_RE, "");
  return text.length > MCP_DESCRIPTION_MAX_CHARS ? `${text.slice(0, MCP_DESCRIPTION_MAX_CHARS)}...` : text;
}

export function formatMcpResult(result: z.infer<typeof CompatibilityCallToolResultSchema>): string {
  const normalized = CallToolResultSchema.safeParse(result);
  if (!normalized.success) {
    return `[mcp-error] ${JSON.stringify(result)}`;
  }
  const { data } = normalized;
  const parts: string[] = [];
  for (const block of data.content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "image") {
      parts.push(`[image: ${block.mimeType}]`);
    } else if (block.type === "resource") {
      const res = block.resource;
      if ("text" in res && typeof res.text === "string") {
        parts.push(res.text);
      } else {
        parts.push(`[resource: ${res.uri}]`);
      }
    }
  }
  if (data.isError) {
    return `[mcp-error] ${parts.join("\n")}`;
  }
  return parts.join("\n");
}

// Providers accept only word characters and hyphens in a tool name, while server names are free-form.
const TOOL_ID_INVALID_RE = /[^a-zA-Z0-9_-]/g;

export function buildToolId(serverName: string, toolName: string): string {
  return `mcp-${serverName}-${toolName.replace(/_/g, "-")}`.replace(TOOL_ID_INVALID_RE, "-");
}

function bindMcpToolDefinition(
  serverName: string,
  mcpTool: McpTool,
  config: McpServerConfig,
  session: SessionContext,
  sessionId?: string,
): ToolDefinition {
  const toolId = buildToolId(serverName, mcpTool.name);
  const inputSchema = (mcpTool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>;
  const description = sanitizeDescription(mcpTool.description, `Call ${mcpTool.name} on MCP server "${serverName}"`);

  return createTool({
    id: toolId,
    toolkit: "mcp",
    category: "network",
    description,
    inputSchema,
    outputSchema: z.object({
      kind: z.literal("mcp-call"),
      server: z.string(),
      tool: z.string(),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      const args = toolInput as Record<string, unknown>;
      return runTool(session, toolId, toolCallId, args, async () => {
        if (sessionId) {
          // Reuse the persistent session connection (self-healing via onclose).
          const { client } = await getOrConnectClient(sessionId, serverName, config);
          const result = await client.callTool({ name: mcpTool.name, arguments: args });
          return { kind: "mcp-call" as const, server: serverName, tool: mcpTool.name, output: formatMcpResult(result) };
        }

        // No session (e.g. one-shot run): ephemeral connect/call/close.
        const client = new Client(MCP_CLIENT_INFO);
        const transport = createMcpTransport(config);
        try {
          await client.connect(transport);
          const result = await client.callTool({ name: mcpTool.name, arguments: args });
          return { kind: "mcp-call" as const, server: serverName, tool: mcpTool.name, output: formatMcpResult(result) };
        } finally {
          await client.close();
        }
      });
    },
  });
}

/**
 * The one place a run's servers are resolved: the workspace configuration, plus every enabled
 * plugin's servers under their plugin-qualified names. A workspace server keeps a contested name.
 */
export async function resolveMcpServers(
  workspace: string,
  pluginsEnabled: boolean,
): Promise<Record<string, McpServerConfig>> {
  const servers: Record<string, McpServerConfig> = { ...readMcpConfig(workspace).mcpServers };
  if (!pluginsEnabled) return servers;

  const { plugins } = await loadPlugins(workspace);
  await ensurePluginDataDirs(plugins);
  for (const [serverName, config] of Object.entries(collectPluginMcpServers(plugins))) {
    if (serverName in servers) {
      log.warn("mcp.server.collision", { server: serverName });
      continue;
    }
    servers[serverName] = config;
  }
  return servers;
}

/**
 * Async phase: for each configured server, get the tool listing — reusing the
 * session connection if a sessionId is given, otherwise connecting ephemerally.
 */
export async function listMcpTools(
  servers: Record<string, McpServerConfig>,
  sessionId?: string,
): Promise<McpToolListing[]> {
  const listings: McpToolListing[] = [];

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    if (isInsecureRemoteHttp(serverConfig)) {
      log.warn("mcp.server.insecure_http", { server: serverName, url: (serverConfig as McpHttpServerConfig).url });
      continue;
    }
    try {
      if (sessionId) {
        const { tools } = await getOrConnectClient(sessionId, serverName, serverConfig);
        listings.push({ serverName, config: serverConfig, tools });
      } else {
        const client = new Client(MCP_CLIENT_INFO);
        const transport = createMcpTransport(serverConfig);
        try {
          await withDeadline(client.connect(transport), MCP_CONNECT_TIMEOUT_MS, `mcp/${serverName}/connect`);
          const { tools } = await withDeadline(
            client.listTools(),
            MCP_CONNECT_TIMEOUT_MS,
            `mcp/${serverName}/listTools`,
          );
          listings.push({ serverName, config: serverConfig, tools });
        } finally {
          try {
            await client.close();
          } catch {
            // ignore close errors
          }
        }
      }
    } catch (error) {
      log.warn("mcp.server.unavailable", { server: serverName, error: errorMessage(error) });
    }
  }

  return listings;
}

/** Sync phase: bind listed tools to the active session, producing tool definitions. */
export function bindMcpTools(
  listings: McpToolListing[],
  session: SessionContext,
  nativeToolIds: Set<string>,
  sessionId?: string,
): Record<string, ToolDefinition> {
  const toolMap: Record<string, ToolDefinition> = {};

  for (const { serverName, config, tools } of listings) {
    for (const mcpTool of tools) {
      const toolId = buildToolId(serverName, mcpTool.name);
      if (nativeToolIds.has(toolId) || toolId in toolMap) {
        log.warn("mcp.tool.collision", { server: serverName, tool: toolId });
        continue;
      }
      toolMap[toolId] = bindMcpToolDefinition(serverName, mcpTool, config, session, sessionId);
    }
  }

  return toolMap;
}
