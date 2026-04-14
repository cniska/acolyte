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
import type { McpHttpServerConfig, McpServerConfig, McpStdioServerConfig } from "./mcp-contract";
import { createTool, type ToolDefinition } from "./tool-contract";
import { runTool } from "./tool-execution";
import type { SessionContext } from "./tool-session";

// biome-ignore lint/suspicious/noExplicitAny: MCP tools have open-world schemas
type AnyToolDefinition = ToolDefinition<any, any>;

export type McpToolListing = {
  serverName: string;
  config: McpServerConfig;
  tools: McpTool[];
};

function createTransport(config: McpServerConfig) {
  if (config.type === "stdio") {
    return createStdioTransport(config);
  }
  return createHttpTransport(config);
}

function createStdioTransport(config: McpStdioServerConfig) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  if (config.env) Object.assign(env, config.env);
  return new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env,
  });
}

function createHttpTransport(config: McpHttpServerConfig) {
  const headers: Record<string, string> = config.headers ?? {};
  return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } });
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
): AnyToolDefinition {
  const toolId = buildToolId(serverName, mcpTool.name);
  const rawInputSchema = (mcpTool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>;

  return createTool({
    id: toolId,
    toolkit: "mcp",
    category: "network",
    description: mcpTool.description ?? `Call ${mcpTool.name} on MCP server "${serverName}"`,
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
        const client = new Client({ name: "acolyte", version: "1.0" });
        const transport = createTransport(config);
        try {
          await client.connect(transport);
          const result = await client.callTool({
            name: mcpTool.name,
            arguments: toolInput as Record<string, unknown>,
          });
          return {
            kind: "mcp-call" as const,
            server: serverName,
            tool: mcpTool.name,
            output: formatMcpResult(result),
          };
        } finally {
          await client.close();
        }
      });
    },
  });
}

/** Async phase: connect to each configured server, list its tools, disconnect. No session needed. */
export async function listMcpTools(workspace: string): Promise<McpToolListing[]> {
  const config = readMcpConfig(workspace);
  const listings: McpToolListing[] = [];

  for (const [serverName, serverConfig] of Object.entries(config.servers)) {
    const client = new Client({ name: "acolyte", version: "1.0" });
    const transport = createTransport(serverConfig);
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      await client.close();
      listings.push({ serverName, config: serverConfig, tools });
    } catch (error) {
      log.warn("mcp.server.unavailable", { server: serverName, error: errorMessage(error) });
      try {
        await client.close();
      } catch {
        // ignore close errors
      }
    }
  }

  return listings;
}

/** Sync phase: bind listed tools to the active session, producing tool definitions. */
export function bindMcpTools(
  listings: McpToolListing[],
  session: SessionContext,
  nativeToolIds: Set<string>,
): Record<string, AnyToolDefinition> {
  const toolMap: Record<string, AnyToolDefinition> = {};

  for (const { serverName, config, tools } of listings) {
    for (const mcpTool of tools) {
      const toolId = buildToolId(serverName, mcpTool.name);
      if (nativeToolIds.has(toolId)) {
        log.warn("mcp.tool.collision", { server: serverName, tool: toolId });
        continue;
      }
      toolMap[toolId] = bindMcpToolDefinition(serverName, mcpTool, config, session);
    }
  }

  return toolMap;
}
