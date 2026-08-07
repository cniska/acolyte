import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_MANIFEST_SCHEMA_ID, PLUGIN_MCP_SCHEMA_ID, PLUGIN_ROOT_VAR, type PluginMeta } from "./plugin-contract";
import { collectPluginMcpServers, ensurePluginDataDirs, resetPluginCache, scanPlugins } from "./plugin-ops";
import { tempDir, writePlugin } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
const originalHome = process.env.HOME;
const originalDataHome = process.env.XDG_DATA_HOME;

// The scanner reads ~/.agents/plugins, so every case owns its home directory rather than the developer's.
beforeEach(() => {
  const home = createDir("acolyte-plugins-home-");
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(home, "data");
});

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalDataHome;
  resetPluginCache();
  cleanupDirs();
});

const SKILL = "---\nname: demo-skill\ndescription: A demo skill from a plugin.\n---\nBody";

function byName(plugins: PluginMeta[], name: string): PluginMeta {
  const found = plugins.find((plugin) => plugin.name === name);
  if (!found) throw new Error(`plugin not loaded: ${name}`);
  return found;
}

describe("plugin scanner", () => {
  test("loads a plugin and its skills from the workspace", async () => {
    const cwd = createDir("acolyte-plugins-project-");
    writePlugin(cwd, "demo", { skills: { "demo-skill": SKILL } });

    const { plugins, diagnostics } = await scanPlugins(cwd);

    expect(plugins).toHaveLength(1);
    expect(byName(plugins, "demo").scope).toBe("project");
    expect(byName(plugins, "demo").skills).toEqual([
      {
        name: "demo-skill",
        description: "A demo skill from a plugin.",
        path: join(byName(plugins, "demo").root, "skills", "demo-skill", "SKILL.md"),
        source: "plugin",
        plugin: "demo",
      },
    ]);
    expect(diagnostics.loaded).toBe(1);
    expect(diagnostics.skills).toBe(1);
  });

  test("loads a plugin from the home directory", async () => {
    const cwd = createDir("acolyte-plugins-empty-");
    writePlugin(process.env.HOME as string, "global", {});

    const { plugins } = await scanPlugins(cwd);

    expect(plugins.map((plugin) => [plugin.name, plugin.scope])).toEqual([["global", "user"]]);
  });

  test("a workspace plugin shadows a home plugin of the same name", async () => {
    const cwd = createDir("acolyte-plugins-shadow-");
    writePlugin(cwd, "demo", {});
    writePlugin(process.env.HOME as string, "demo", {});

    const { plugins, diagnostics } = await scanPlugins(cwd);

    expect(plugins).toHaveLength(1);
    expect(byName(plugins, "demo").scope).toBe("project");
    expect(diagnostics.duplicates).toBe(1);
  });

  test("a directory without a manifest is not a plugin", async () => {
    const cwd = createDir("acolyte-plugins-nomanifest-");
    writePlugin(cwd, "demo", { manifest: null });

    const { plugins, diagnostics } = await scanPlugins(cwd);

    expect(plugins).toHaveLength(0);
    expect(diagnostics.missingManifests).toBe(1);
    expect(diagnostics.rejected).toBe(0);
  });

  test("rejects an unreadable, invalid, or unsupported manifest", async () => {
    const cwd = createDir("acolyte-plugins-bad-");
    writePlugin(cwd, "broken", { manifest: "{not json" });
    writePlugin(cwd, "nameless", { manifest: { $schema: PLUGIN_MANIFEST_SCHEMA_ID } });
    writePlugin(cwd, "future", {
      manifest: { $schema: "https://agent-plugins.org/schemas/2.0.0/plugin.schema.json", name: "future" },
    });

    const { plugins, diagnostics } = await scanPlugins(cwd);

    expect(plugins).toHaveLength(0);
    expect(diagnostics.rejected).toBe(3);
  });

  test("keeps a plugin whose manifest carries an unknown top-level field", async () => {
    const cwd = createDir("acolyte-plugins-unknown-");
    writePlugin(cwd, "demo", {
      manifest: { $schema: PLUGIN_MANIFEST_SCHEMA_ID, name: "demo", futureThing: true },
    });

    const { plugins, diagnostics } = await scanPlugins(cwd);

    expect(plugins).toHaveLength(1);
    expect(diagnostics.unknownFields).toBe(1);
  });

  test("takes the plugin name from the manifest, not the directory", async () => {
    const cwd = createDir("acolyte-plugins-rename-");
    writePlugin(cwd, "dir-name", { manifest: { $schema: PLUGIN_MANIFEST_SCHEMA_ID, name: "acme.tools" } });

    const { plugins } = await scanPlugins(cwd);

    expect(plugins.map((plugin) => plugin.name)).toEqual(["acme.tools"]);
  });

  test("loads a plugin reached through a symlink", async () => {
    const cwd = createDir("acolyte-plugins-symlink-");
    const external = createDir("acolyte-plugins-external-");
    const real = writePlugin(external, "linked", { skills: { "demo-skill": SKILL } });
    mkdirSync(join(cwd, ".agents", "plugins"), { recursive: true });
    symlinkSync(real, join(cwd, ".agents", "plugins", "linked"));

    const { plugins } = await scanPlugins(cwd);

    expect(plugins).toHaveLength(1);
    expect(byName(plugins, "linked").skills).toHaveLength(1);
  });

  test("does not discover skills nested deeper than one level", async () => {
    const cwd = createDir("acolyte-plugins-nested-");
    const root = writePlugin(cwd, "demo", {});
    const nested = join(root, "skills", "group", "inner");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "SKILL.md"), SKILL, "utf8");

    const { plugins } = await scanPlugins(cwd);

    expect(byName(plugins, "demo").skills).toEqual([]);
  });
});

describe("plugin mcp servers", () => {
  test("normalizes and qualifies server names", async () => {
    const cwd = createDir("acolyte-plugins-mcp-");
    writePlugin(cwd, "tools", {
      mcp: {
        $schema: PLUGIN_MCP_SCHEMA_ID,
        mcpServers: {
          local: { type: "stdio", command: "./bin/serve", args: [`\${${PLUGIN_ROOT_VAR}}/x`] },
          remote: { type: "streamable-http", url: "https://example.com/mcp" },
        },
      },
    });

    const { plugins, diagnostics } = await scanPlugins(cwd);
    const servers = collectPluginMcpServers(plugins);
    const root = byName(plugins, "tools").root;

    expect(Object.keys(servers).sort()).toEqual(["tools-local", "tools-remote"]);
    expect(servers["tools-local"]).toEqual({
      type: "stdio",
      command: join(root, "bin", "serve"),
      args: [join(root, "x")],
      env: { PLUGIN_ROOT: root, PLUGIN_DATA: byName(plugins, "tools").dataDir },
      cwd: root,
    });
    expect(servers["tools-remote"]).toEqual({ type: "http", url: "https://example.com/mcp" });
    expect(diagnostics.servers).toBe(2);
  });

  test("skips an sse server but keeps the rest of the file", async () => {
    const cwd = createDir("acolyte-plugins-sse-");
    writePlugin(cwd, "tools", {
      mcp: {
        $schema: PLUGIN_MCP_SCHEMA_ID,
        mcpServers: {
          legacy: { type: "sse", url: "https://example.com/sse" },
          remote: { type: "streamable-http", url: "https://example.com/mcp" },
        },
      },
    });

    const { plugins, diagnostics } = await scanPlugins(cwd);

    expect(Object.keys(byName(plugins, "tools").mcpServers)).toEqual(["tools-remote"]);
    expect(diagnostics.skippedServers).toBe(1);
  });

  test("an invalid server entry is skipped while its siblings still load", async () => {
    const cwd = createDir("acolyte-plugins-mcpbad-");
    writePlugin(cwd, "tools", {
      mcp: {
        $schema: PLUGIN_MCP_SCHEMA_ID,
        mcpServers: {
          bad: { type: "stdio", command: "node serve.js" },
          good: { type: "streamable-http", url: "https://example.com/mcp" },
        },
      },
      skills: { "demo-skill": SKILL },
    });

    const { plugins, diagnostics } = await scanPlugins(cwd);

    expect(Object.keys(byName(plugins, "tools").mcpServers)).toEqual(["tools-good"]);
    expect(byName(plugins, "tools").skills).toHaveLength(1);
    expect(diagnostics.skippedServers).toBe(1);
    expect(diagnostics.mcpDisabled).toBe(0);
  });

  test("an unreadable mcp.json disables the plugin's servers but keeps its skills", async () => {
    const cwd = createDir("acolyte-plugins-mcpunreadable-");
    writePlugin(cwd, "tools", { mcp: "{not json", skills: { "demo-skill": SKILL } });

    const { plugins, diagnostics } = await scanPlugins(cwd);

    expect(byName(plugins, "tools").mcpServers).toEqual({});
    expect(byName(plugins, "tools").skills).toHaveLength(1);
    expect(diagnostics.mcpDisabled).toBe(1);
  });

  test("drops a server whose command reaches outside the plugin through a symlink", async () => {
    const cwd = createDir("acolyte-plugins-symlinkescape-");
    const outside = createDir("acolyte-plugins-outside-");
    writeFileSync(join(outside, "evil.sh"), "#!/bin/sh\n", "utf8");
    const root = writePlugin(cwd, "tools", {
      mcp: { $schema: PLUGIN_MCP_SCHEMA_ID, mcpServers: { sneaky: { type: "stdio", command: "./bin" } } },
    });
    symlinkSync(join(outside, "evil.sh"), join(root, "bin"));

    const { plugins, diagnostics } = await scanPlugins(cwd);

    expect(byName(plugins, "tools").mcpServers).toEqual({});
    expect(diagnostics.skippedServers).toBe(1);
  });

  test("drops a server whose command escapes the plugin root", async () => {
    const cwd = createDir("acolyte-plugins-escape-");
    writePlugin(cwd, "tools", {
      mcp: { $schema: PLUGIN_MCP_SCHEMA_ID, mcpServers: { evil: { type: "stdio", command: "./../evil" } } },
    });

    const { plugins, diagnostics } = await scanPlugins(cwd);

    expect(byName(plugins, "tools").mcpServers).toEqual({});
    expect(diagnostics.skippedServers).toBe(1);
  });

  test("creates the data directory only for plugins that declare servers", async () => {
    const cwd = createDir("acolyte-plugins-data-");
    writePlugin(cwd, "withserver", {
      mcp: { $schema: PLUGIN_MCP_SCHEMA_ID, mcpServers: { local: { type: "stdio", command: "node" } } },
    });
    writePlugin(cwd, "skillsonly", { skills: { "demo-skill": SKILL } });

    const { plugins } = await scanPlugins(cwd);
    await ensurePluginDataDirs(plugins);

    expect(existsSync(byName(plugins, "withserver").dataDir)).toBe(true);
    expect(existsSync(byName(plugins, "skillsonly").dataDir)).toBe(false);
  });

  test("scopes the data directory per plugin instance", async () => {
    const cwd = createDir("acolyte-plugins-datascope-");
    writePlugin(cwd, "project-one", {});
    writePlugin(process.env.HOME as string, "user-one", {});

    const { plugins } = await scanPlugins(cwd);

    expect(byName(plugins, "project-one").dataDir).toBe(join(cwd, ".acolyte", "plugin-data", "project-one"));
    expect(byName(plugins, "user-one").dataDir).toBe(
      join(process.env.XDG_DATA_HOME as string, "acolyte", "plugins", "user-one"),
    );
  });
});

describe("plugin skill faults", () => {
  test("counts a skill whose SKILL.md is unusable", async () => {
    const cwd = createDir("acolyte-plugins-badskill-");
    const root = writePlugin(cwd, "demo", { skills: { good: SKILL.replace("demo-skill", "good") } });
    const bad = join(root, "skills", "bad");
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, "SKILL.md"), "no frontmatter here", "utf8");

    const { plugins, diagnostics } = await scanPlugins(cwd);

    expect(byName(plugins, "demo").skills).toHaveLength(1);
    expect(diagnostics.skillsInvalid).toBe(1);
  });

  test("counts a skill name a earlier plugin already claimed", async () => {
    const cwd = createDir("acolyte-plugins-dupskill-");
    writePlugin(cwd, "aaa", { skills: { "demo-skill": SKILL } });
    writePlugin(cwd, "zzz", { skills: { "demo-skill": SKILL } });

    const { plugins, diagnostics } = await scanPlugins(cwd);

    expect(byName(plugins, "aaa").skills).toHaveLength(1);
    expect(byName(plugins, "zzz").skills).toHaveLength(0);
    expect(diagnostics.skillsDuplicates).toBe(1);
  });
});
