import { describe, expect, test } from "bun:test";
import {
  declaredSchemaVersion,
  expandPluginVars,
  isContainedPath,
  normalizePluginMcpServer,
  PLUGIN_DATA_PLACEHOLDER,
  PLUGIN_MANIFEST_SCHEMA_ID,
  PLUGIN_MCP_SCHEMA_ID,
  PLUGIN_ROOT_PLACEHOLDER,
  type PluginPaths,
  pluginManifestSchema,
  pluginMcpFileSchema,
  pluginMcpServerSchema,
  qualifyPluginServerName,
  unknownManifestFields,
  validatePluginName,
} from "./plugin-contract";

const PATHS: PluginPaths = { root: "/plugins/demo", dataDir: "/data/demo" };

function parseServer(entry: unknown) {
  const result = pluginMcpServerSchema.safeParse(entry);
  if (!result.success) throw new Error("expected a valid server entry");
  return result.data;
}

describe("validatePluginName", () => {
  test("accepts names the spec allows", () => {
    expect(validatePluginName("my-plugin")).toBeNull();
    expect(validatePluginName("acme.tools")).toBeNull();
    expect(validatePluginName("lint3r")).toBeNull();
    expect(validatePluginName("a")).toBeNull();
  });

  test("rejects empty and over-long names", () => {
    expect(validatePluginName("")).not.toBeNull();
    expect(validatePluginName("a".repeat(65))).not.toBeNull();
    expect(validatePluginName("a".repeat(64))).toBeNull();
  });

  test("rejects uppercase and non-alphanumeric edges", () => {
    expect(validatePluginName("MyPlugin")).not.toBeNull();
    expect(validatePluginName("-start")).not.toBeNull();
    expect(validatePluginName("end-")).not.toBeNull();
    expect(validatePluginName(".start")).not.toBeNull();
    expect(validatePluginName("end.")).not.toBeNull();
  });

  test("rejects consecutive separators", () => {
    expect(validatePluginName("my--plugin")).not.toBeNull();
    expect(validatePluginName("my..plugin")).not.toBeNull();
  });
});

describe("pluginManifestSchema", () => {
  test("accepts a minimal manifest", () => {
    const result = pluginManifestSchema.safeParse({ $schema: PLUGIN_MANIFEST_SCHEMA_ID, name: "demo" });
    expect(result.success).toBe(true);
  });

  test("rejects a missing or foreign $schema", () => {
    expect(pluginManifestSchema.safeParse({ name: "demo" }).success).toBe(false);
    expect(
      pluginManifestSchema.safeParse({
        $schema: "https://agent-plugins.org/schemas/2.0.0/plugin.schema.json",
        name: "demo",
      }).success,
    ).toBe(false);
  });

  test("rejects a missing name and an invalid name", () => {
    expect(pluginManifestSchema.safeParse({ $schema: PLUGIN_MANIFEST_SCHEMA_ID }).success).toBe(false);
    expect(pluginManifestSchema.safeParse({ $schema: PLUGIN_MANIFEST_SCHEMA_ID, name: "Demo" }).success).toBe(false);
  });

  test("rejects a violation inside a known field", () => {
    expect(
      pluginManifestSchema.safeParse({
        $schema: PLUGIN_MANIFEST_SCHEMA_ID,
        name: "demo",
        author: { name: "a", nickname: "b" },
      }).success,
    ).toBe(false);
  });

  test("accepts an unknown top-level field and reports it", () => {
    const raw = { $schema: PLUGIN_MANIFEST_SCHEMA_ID, name: "demo", futureThing: true };
    expect(pluginManifestSchema.safeParse(raw).success).toBe(true);
    expect(unknownManifestFields(raw)).toEqual(["futureThing"]);
  });

  test("reports no unknown fields for a full manifest", () => {
    expect(
      unknownManifestFields({
        $schema: PLUGIN_MANIFEST_SCHEMA_ID,
        name: "demo",
        version: "1.0.0",
        description: "d",
        author: { name: "a" },
        homepage: "h",
        repository: "r",
        license: "MIT",
        keywords: ["k"],
        extensions: {},
      }),
    ).toEqual([]);
  });
});

describe("declaredSchemaVersion", () => {
  test("extracts the version from a canonical identifier", () => {
    expect(declaredSchemaVersion(PLUGIN_MANIFEST_SCHEMA_ID)).toBe("1.0.0");
    expect(declaredSchemaVersion("https://agent-plugins.org/schemas/2.1.0/mcp.schema.json")).toBe("2.1.0");
  });

  test("returns null for anything else", () => {
    expect(declaredSchemaVersion("https://example.com/plugin.json")).toBeNull();
    expect(declaredSchemaVersion(undefined)).toBeNull();
    expect(declaredSchemaVersion(7)).toBeNull();
  });
});

describe("pluginMcpFileSchema", () => {
  test("accepts stdio, streamable-http, and sse entries", () => {
    const result = pluginMcpFileSchema.safeParse({
      $schema: PLUGIN_MCP_SCHEMA_ID,
      mcpServers: {
        local: { type: "stdio", command: "./bin/serve" },
        remote: { type: "streamable-http", url: "https://example.com/mcp" },
        legacy: { type: "sse", url: "https://example.com/sse" },
      },
    });
    expect(result.success).toBe(true);
  });

  test("rejects extra top-level fields and a foreign $schema", () => {
    expect(pluginMcpFileSchema.safeParse({ $schema: PLUGIN_MCP_SCHEMA_ID, mcpServers: {}, extra: 1 }).success).toBe(
      false,
    );
    expect(pluginMcpFileSchema.safeParse({ $schema: PLUGIN_MANIFEST_SCHEMA_ID, mcpServers: {} }).success).toBe(false);
  });

  test("rejects a command that is a shell string or an absolute path", () => {
    expect(pluginMcpServerSchema.safeParse({ type: "stdio", command: "node serve.js" }).success).toBe(false);
    expect(pluginMcpServerSchema.safeParse({ type: "stdio", command: "/usr/bin/node" }).success).toBe(false);
    expect(pluginMcpServerSchema.safeParse({ type: "stdio", command: "node" }).success).toBe(true);
    expect(pluginMcpServerSchema.safeParse({ type: "stdio", command: "./bin/serve" }).success).toBe(true);
  });

  test("rejects reserved env names", () => {
    expect(
      pluginMcpServerSchema.safeParse({ type: "stdio", command: "node", env: { PLUGIN_ROOT: "/x" } }).success,
    ).toBe(false);
    expect(
      pluginMcpServerSchema.safeParse({ type: "stdio", command: "node", env: { PLUGIN_DATA: "/x" } }).success,
    ).toBe(false);
  });

  test("rejects a cwd outside the permitted forms", () => {
    expect(pluginMcpServerSchema.safeParse({ type: "stdio", command: "node", cwd: "/tmp" }).success).toBe(false);
    expect(pluginMcpServerSchema.safeParse({ type: "stdio", command: "node", cwd: "sub" }).success).toBe(false);
    expect(pluginMcpServerSchema.safeParse({ type: "stdio", command: "node", cwd: "./sub" }).success).toBe(true);
    expect(
      pluginMcpServerSchema.safeParse({ type: "stdio", command: "node", cwd: PLUGIN_ROOT_PLACEHOLDER }).success,
    ).toBe(true);
    expect(
      pluginMcpServerSchema.safeParse({ type: "stdio", command: "node", cwd: `${PLUGIN_DATA_PLACEHOLDER}/state` })
        .success,
    ).toBe(true);
  });

  test("rejects a non-absolute or non-http url", () => {
    expect(pluginMcpServerSchema.safeParse({ type: "streamable-http", url: "/mcp" }).success).toBe(false);
    expect(pluginMcpServerSchema.safeParse({ type: "streamable-http", url: "ws://example.com" }).success).toBe(false);
  });
});

describe("expandPluginVars", () => {
  test("replaces every occurrence of both placeholders", () => {
    expect(
      expandPluginVars(`${PLUGIN_ROOT_PLACEHOLDER}/a:${PLUGIN_ROOT_PLACEHOLDER}/b:${PLUGIN_DATA_PLACEHOLDER}`, PATHS),
    ).toBe("/plugins/demo/a:/plugins/demo/b:/data/demo");
  });

  test("leaves unrelated text and unknown placeholders alone", () => {
    const untouched = `--flag \${HOME}`;
    expect(expandPluginVars(untouched, PATHS)).toBe(untouched);
  });

  test("does not rescan introduced text", () => {
    const paths: PluginPaths = { root: PLUGIN_DATA_PLACEHOLDER, dataDir: "/data/demo" };
    expect(expandPluginVars(PLUGIN_ROOT_PLACEHOLDER, paths)).toBe(PLUGIN_DATA_PLACEHOLDER);
  });
});

describe("isContainedPath", () => {
  test("accepts the base itself and paths beneath it", () => {
    expect(isContainedPath("/a/b", "/a/b")).toBe(true);
    expect(isContainedPath("/a/b", "/a/b/c")).toBe(true);
  });

  test("rejects escapes and siblings", () => {
    expect(isContainedPath("/a/b", "/a")).toBe(false);
    expect(isContainedPath("/a/b", "/a/bc")).toBe(false);
  });
});

describe("normalizePluginMcpServer", () => {
  test("maps streamable-http onto the canonical http transport", () => {
    const result = normalizePluginMcpServer(
      parseServer({ type: "streamable-http", url: "https://example.com/mcp", headers: { A: "1" } }),
      PATHS,
    );
    expect(result).toEqual({
      ok: true,
      server: { type: "http", url: "https://example.com/mcp", headers: { A: "1" } },
    });
  });

  test("declines the legacy sse transport", () => {
    const result = normalizePluginMcpServer(parseServer({ type: "sse", url: "https://example.com/sse" }), PATHS);
    expect(result).toEqual({ ok: false, kind: "server-unsupported-transport" });
  });

  test("resolves a relative command against the plugin root and defaults cwd to it", () => {
    const result = normalizePluginMcpServer(parseServer({ type: "stdio", command: "./bin/serve" }), PATHS);
    expect(result).toEqual({
      ok: true,
      server: {
        type: "stdio",
        command: "/plugins/demo/bin/serve",
        env: { PLUGIN_ROOT: "/plugins/demo", PLUGIN_DATA: "/data/demo" },
        cwd: "/plugins/demo",
      },
    });
  });

  test("leaves a bare command for the platform search path", () => {
    const result = normalizePluginMcpServer(parseServer({ type: "stdio", command: "node" }), PATHS);
    expect(result.ok && result.server.type === "stdio" && result.server.command).toBe("node");
  });

  test("expands placeholders in args, env values, and cwd", () => {
    const result = normalizePluginMcpServer(
      parseServer({
        type: "stdio",
        command: "node",
        args: [`${PLUGIN_ROOT_PLACEHOLDER}/server.js`, `--state=${PLUGIN_DATA_PLACEHOLDER}`],
        env: { STATE: `${PLUGIN_DATA_PLACEHOLDER}/db` },
        cwd: `${PLUGIN_DATA_PLACEHOLDER}/work`,
      }),
      PATHS,
    );
    expect(result).toEqual({
      ok: true,
      server: {
        type: "stdio",
        command: "node",
        args: ["/plugins/demo/server.js", "--state=/data/demo"],
        env: { STATE: "/data/demo/db", PLUGIN_ROOT: "/plugins/demo", PLUGIN_DATA: "/data/demo" },
        cwd: "/data/demo/work",
      },
    });
  });

  test("injects the plugin paths even when the server declares no env", () => {
    const result = normalizePluginMcpServer(parseServer({ type: "stdio", command: "node" }), PATHS);
    expect(result.ok && result.server.type === "stdio" && result.server.env).toEqual({
      PLUGIN_ROOT: "/plugins/demo",
      PLUGIN_DATA: "/data/demo",
    });
  });

  test("rejects a command that escapes the plugin root", () => {
    const result = normalizePluginMcpServer(parseServer({ type: "stdio", command: "./../evil" }), PATHS);
    expect(result).toEqual({ ok: false, kind: "server-path-escape" });
  });

  test("rejects a cwd that escapes its own base", () => {
    expect(normalizePluginMcpServer(parseServer({ type: "stdio", command: "node", cwd: "./../up" }), PATHS)).toEqual({
      ok: false,
      kind: "server-path-escape",
    });
    expect(
      normalizePluginMcpServer(
        parseServer({ type: "stdio", command: "node", cwd: `${PLUGIN_ROOT_PLACEHOLDER}/../up` }),
        PATHS,
      ),
    ).toEqual({ ok: false, kind: "server-path-escape" });
    expect(
      normalizePluginMcpServer(
        parseServer({ type: "stdio", command: "node", cwd: `${PLUGIN_DATA_PLACEHOLDER}/../up` }),
        PATHS,
      ),
    ).toEqual({ ok: false, kind: "server-path-escape" });
  });
});

describe("qualifyPluginServerName", () => {
  test("prefixes the plugin name so workspace servers cannot collide", () => {
    expect(qualifyPluginServerName("acme.tools", "github")).toBe("acme.tools-github");
  });
});
