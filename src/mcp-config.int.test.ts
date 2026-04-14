import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readMcpConfig } from "./mcp-config";
import { tempDir } from "./test-utils";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

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
