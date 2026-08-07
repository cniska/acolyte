import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveMcpServers } from "./mcp-client";
import { readMcpConfig } from "./mcp-contract";
import { PLUGIN_MCP_SCHEMA_ID } from "./plugin-contract";
import { resetPluginCache } from "./plugin-ops";
import { tempDir, writePlugin } from "./test-utils";

const dirs = tempDir();
const originalHome = process.env.HOME;

beforeEach(() => {
  process.env.HOME = dirs.createDir("acolyte-mcp-home-");
});

afterEach(() => {
  process.env.HOME = originalHome;
  resetPluginCache();
  dirs.cleanupDirs();
});

async function writeJson(path: string, data: unknown) {
  await writeFile(path, JSON.stringify(data), "utf8");
}

describe("readMcpConfig", () => {
  test("returns empty servers when no config files exist", () => {
    const workspace = dirs.createDir("acolyte-mcp-empty-");
    const config = readMcpConfig(workspace);
    expect(config.mcpServers).toEqual({});
  });

  test("reads project-level stdio server from .mcp.json", async () => {
    const workspace = dirs.createDir("acolyte-mcp-project-");
    await writeJson(join(workspace, ".mcp.json"), {
      mcpServers: {
        figma: { type: "stdio", command: "npx", args: ["-y", "@figma/mcp-server"] },
      },
    });

    const config = readMcpConfig(workspace);
    expect(config.mcpServers.figma).toMatchObject({ type: "stdio", command: "npx" });
  });

  test("reads project-level http server from .mcp.json", async () => {
    const workspace = dirs.createDir("acolyte-mcp-http-");
    await writeJson(join(workspace, ".mcp.json"), {
      mcpServers: {
        jira: { type: "http", url: "https://mcp.atlassian.com/v1" },
      },
    });

    const config = readMcpConfig(workspace);
    expect(config.mcpServers.jira).toMatchObject({ type: "http", url: "https://mcp.atlassian.com/v1" });
  });

  test("silently ignores invalid JSON", async () => {
    const workspace = dirs.createDir("acolyte-mcp-invalid-");
    await writeFile(join(workspace, ".mcp.json"), "not json {{{", "utf8");

    const config = readMcpConfig(workspace);
    expect(config.mcpServers).toEqual({});
  });

  test("silently ignores servers that fail schema validation", async () => {
    const workspace = dirs.createDir("acolyte-mcp-bad-schema-");
    await writeJson(join(workspace, ".mcp.json"), {
      mcpServers: {
        bad: { type: "unknown-transport" },
      },
    });

    const config = readMcpConfig(workspace);
    // invalid server is dropped by Zod discriminated union
    expect(config.mcpServers.bad).toBeUndefined();
  });

  test("reads multiple servers", async () => {
    const workspace = dirs.createDir("acolyte-mcp-multi-");
    await writeJson(join(workspace, ".mcp.json"), {
      mcpServers: {
        figma: { type: "stdio", command: "npx" },
        notion: { type: "http", url: "https://notion.example.com/mcp" },
      },
    });

    const config = readMcpConfig(workspace);
    expect(config.mcpServers.figma).toMatchObject({ command: "npx" });
    expect(config.mcpServers.notion).toMatchObject({ type: "http" });
  });
});

describe("resolveMcpServers", () => {
  function writePluginServer(workspace: string, dirName: string, serverName: string): void {
    writePlugin(workspace, dirName, {
      mcp: {
        $schema: PLUGIN_MCP_SCHEMA_ID,
        mcpServers: { [serverName]: { type: "streamable-http", url: "https://example.com/mcp" } },
      },
    });
  }

  test("returns only workspace servers while plugins are disabled", async () => {
    const workspace = dirs.createDir("acolyte-mcp-resolve-off-");
    await writeJson(join(workspace, ".mcp.json"), { mcpServers: { figma: { type: "stdio", command: "npx" } } });
    writePluginServer(workspace, "acme", "remote");

    const servers = await resolveMcpServers(workspace, false);

    expect(Object.keys(servers)).toEqual(["figma"]);
  });

  test("adds plugin servers under their plugin-qualified names", async () => {
    const workspace = dirs.createDir("acolyte-mcp-resolve-on-");
    await writeJson(join(workspace, ".mcp.json"), { mcpServers: { figma: { type: "stdio", command: "npx" } } });
    writePluginServer(workspace, "acme", "remote");

    const servers = await resolveMcpServers(workspace, true);

    expect(Object.keys(servers).sort()).toEqual(["acme-remote", "figma"]);
    expect(servers["acme-remote"]).toEqual({ type: "http", url: "https://example.com/mcp" });
  });

  test("a workspace server keeps a name a plugin server would take", async () => {
    const workspace = dirs.createDir("acolyte-mcp-resolve-collide-");
    await writeJson(join(workspace, ".mcp.json"), {
      mcpServers: { "acme-remote": { type: "stdio", command: "npx" } },
    });
    writePluginServer(workspace, "acme", "remote");

    const servers = await resolveMcpServers(workspace, true);

    expect(Object.keys(servers)).toEqual(["acme-remote"]);
    expect(servers["acme-remote"]).toMatchObject({ type: "stdio", command: "npx" });
  });
});
