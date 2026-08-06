import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_MANIFEST_SCHEMA_ID } from "./plugin-contract";
import { resetPluginCache } from "./plugin-ops";
import { collectResourceDiagnostics } from "./resource-diagnostics";
import { loadSkills, resetSkillCache } from "./skill-ops";
import { tempDir, writePlugin, writeSkill } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();

afterEach(() => {
  resetSkillCache();
  resetPluginCache();
  cleanupDirs();
});

describe("resource diagnostics", () => {
  test("reports project config collisions when both toml and json exist", () => {
    const cwd = createDir("acolyte-resdiag-project-");
    const home = createDir("acolyte-resdiag-home-");
    const projectConfig = join(cwd, ".acolyte");
    mkdirSync(projectConfig, { recursive: true });
    writeFileSync(join(projectConfig, "config.toml"), 'model = "gpt-5-mini"\n', "utf8");
    writeFileSync(join(projectConfig, "config.json"), '{"model":"gpt-5"}\n', "utf8");

    const diagnostics = collectResourceDiagnostics({ cwd, env: { HOME: home } });
    expect(diagnostics["resources.config.collisions"]).toBe("project");
  });

  test("reports missing AGENTS.md", () => {
    const cwd = createDir("acolyte-resdiag-prompts-");
    const home = createDir("acolyte-resdiag-home-");

    const diagnostics = collectResourceDiagnostics({ cwd, env: { HOME: home } });
    expect(diagnostics["resources.prompt.agents"]).toBe("missing_or_unreadable");
  });

  test("reports invalid loaded skills", async () => {
    const cwd = createDir("acolyte-resdiag-skills-invalid-");
    const home = createDir("acolyte-resdiag-home-");
    writeSkill(cwd, "bad", "---\nname: Bad\ndescription: Invalid skill name\n---");

    await loadSkills(cwd);
    const diagnostics = collectResourceDiagnostics({ cwd, env: { HOME: home } });
    expect(diagnostics["resources.skills.invalid"]).toBe(1);
    expect(diagnostics["resources.skills.status"]).toBeUndefined();
  });

  test("returns empty diagnostics when resources are healthy", async () => {
    const cwd = createDir("acolyte-resdiag-ok-");
    const home = createDir("acolyte-resdiag-home-");
    writeFileSync(join(cwd, "AGENTS.md"), "# Agents\n", "utf8");
    writeSkill(cwd, "demo", "---\nname: demo\ndescription: Demo skill\n---");

    await loadSkills(cwd);
    const diagnostics = collectResourceDiagnostics({ cwd, env: { HOME: home } });
    expect(diagnostics).toEqual({});
  });

  test("counts loaded and rejected plugins", async () => {
    const cwd = createDir("acolyte-resdiag-plugins-");
    const home = createDir("acolyte-resdiag-home-");
    writeFileSync(join(cwd, "AGENTS.md"), "# Agents\n", "utf8");
    mkdirSync(join(cwd, ".acolyte"), { recursive: true });
    writeFileSync(join(cwd, ".acolyte", "config.json"), JSON.stringify({ features: { plugins: true } }), "utf8");
    writePlugin(cwd, "good", {});
    writePlugin(cwd, "bad", { manifest: { $schema: PLUGIN_MANIFEST_SCHEMA_ID } });

    await loadSkills(cwd);
    const diagnostics = collectResourceDiagnostics({ cwd, env: { HOME: home } });

    expect(diagnostics["resources.plugins.loaded"]).toBe(1);
    expect(diagnostics["resources.plugins.rejected"]).toBe(1);
  });
});
