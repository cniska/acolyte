import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectResourceDiagnostics } from "./resource-diagnostics";
import { loadSkills, resetSkillCache } from "./skills";
import { tempDir, writeSkill } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();

afterEach(() => {
  resetSkillCache();
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

    const diagnostics = collectResourceDiagnostics({ cwd, homeDir: home });
    expect(diagnostics["resources.config.collisions"]).toBe("project");
  });

  test("reports missing prompt resources", () => {
    const cwd = createDir("acolyte-resdiag-prompts-");
    const home = createDir("acolyte-resdiag-home-");

    const diagnostics = collectResourceDiagnostics({ cwd, homeDir: home });
    expect(diagnostics["resources.prompt.soul"]).toBe("missing_or_unreadable");
    expect(diagnostics["resources.prompt.agents"]).toBe("missing_or_unreadable");
  });

  test("reports invalid loaded skills", async () => {
    const cwd = createDir("acolyte-resdiag-skills-invalid-");
    const home = createDir("acolyte-resdiag-home-");
    writeSkill(cwd, "bad", "---\nname: Bad\ndescription: Invalid skill name\n---");

    await loadSkills(cwd);
    const diagnostics = collectResourceDiagnostics({ cwd, homeDir: home });
    expect(diagnostics["resources.skills.invalid"]).toBe(1);
    expect(diagnostics["resources.skills.status"]).toBe("no_valid_skills_loaded");
  });

  test("returns empty diagnostics when resources are healthy", async () => {
    const cwd = createDir("acolyte-resdiag-ok-");
    const home = createDir("acolyte-resdiag-home-");
    mkdirSync(join(cwd, "docs"), { recursive: true });
    writeFileSync(join(cwd, "docs", "soul.md"), "# Soul\n", "utf8");
    writeFileSync(join(cwd, "AGENTS.md"), "# Agents\n", "utf8");
    writeSkill(cwd, "demo", "---\nname: demo\ndescription: Demo skill\n---");

    await loadSkills(cwd);
    const diagnostics = collectResourceDiagnostics({ cwd, homeDir: home });
    expect(diagnostics).toEqual({});
  });
});
