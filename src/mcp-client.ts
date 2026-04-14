import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  type CompatibilityCallToolResultSchema,
  type Tool as McpTool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { errorMessage } from "./error-contract";
import { log } from "./log";
import { readMcpConfig } from "./mcp-config";
import {
  MCP_CLIENT_INFO,
  MCP_CONNECT_TIMEOUT_MS,
  type McpHttpServerConfig,
  type McpServerConfig,
  type McpStdioServerConfig,
  STDIO_ENV_ALLOWLIST,
} from "./mcp-contract";
import { getOrConnectClient } from "./mcp-session";
import { createTool, type ToolDefinition } from "./tool-contract";
import { runTool } from "./tool-execution";
import type { SessionContext } from "./tool-session";

// biome-ignore lint/suspicious/noExplicitAny: MCP tools have open-world schemas
type AnyToolDefinition = ToolDefinition<any, any>;

const MCP_DESCRIPTION_MAX_CHARS = 512;

export type McpToolListing = {
  serverName: string;
  config: McpServerConfig;
  tools: McpTool[];
};

function createEphemeralTransport(config: McpServerConfig) {
  if (config.type === "stdio") {
    return createStdioTransport(config);
  }
  return createHttpTransport(config);
}

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

function createStdioTransport(config: McpStdioServerConfig) {
  const env: Record<string, string> = {};
  for (const key of STDIO_ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  if (config.env) Object.assign(env, config.env);
  return new StdioClientTransport({ command: config.command, args: config.args ?? [], env });
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

function createHttpTransport(config: McpHttpServerConfig) {
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers ?? {} },
  });
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

function buildToolId(serverName: string, toolName: string): string {
  return `mcp-${serverName}-${toolName.replace(/_/g, "-")}`;
}

function bindMcpToolDefinition(
  serverName: string,
  mcpTool: McpTool,
  config: McpServerConfig,
  session: SessionContext,
  sessionId?: string,
): AnyToolDefinition {
  const toolId = buildToolId(serverName, mcpTool.name);
  const rawInputSchema = (mcpTool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>;
  const description = sanitizeDescription(mcpTool.description, `Call ${mcpTool.name} on MCP server "${serverName}"`);

  return createTool({
    id: toolId,
    toolkit: "mcp",
    category: "network",
    description,
    instruction: `Use ${toolId} to call the "${mcpTool.name}" tool on the "${serverName}" MCP server.`,
    inputSchema: z.object({}).passthrough(),
    rawInputSchema,
    outputSchema: z.object({
      kind: z.literal("mcp-call"),
      server: z.string(),
      tool: z.string(),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(session, toolId, toolCallId, toolInput as Record<string, unknown>, async () => {
        const args = toolInput as Record<string, unknown>;

        if (sessionId) {
          // Reuse the persistent session connection (self-healing via onclose).
          const { client } = await getOrConnectClient(sessionId, serverName, config);
          const result = await client.callTool({ name: mcpTool.name, arguments: args });
          return { kind: "mcp-call" as const, server: serverName, tool: mcpTool.name, output: formatMcpResult(result) };
        }

        // No session (e.g. one-shot run): ephemeral connect/call/close.
        const client = new Client(MCP_CLIENT_INFO);
        const transport = createEphemeralTransport(config);
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
 * Async phase: for each configured server, get the tool listing — reusing the
 * session connection if a sessionId is given, otherwise connecting ephemerally.
 */
export async function listMcpTools(workspace: string, sessionId?: string): Promise<McpToolListing[]> {
  const config = readMcpConfig(workspace);
  const listings: McpToolListing[] = [];

  for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
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
        const transport = createEphemeralTransport(serverConfig);
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
): Record<string, AnyToolDefinition> {
  const toolMap: Record<string, AnyToolDefinition> = {};

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
