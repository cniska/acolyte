import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSkillToolkit } from "./skill-toolkit";
import { loadSkills, resetSkillCache } from "./skills";
import { tempDir } from "./test-utils";
import type { ToolkitInput } from "./tool-contract";
import { createSessionContext } from "./tool-session";

type SkillListResult = { kind: string; skills: { name: string; description: string; source: string }[] };
type SkillActivateResult = { kind: string; name: string; source: string; instructions: string };

const { createDir, cleanupDirs } = tempDir();

function createToolkitInput(workspace: string): ToolkitInput {
  return {
    workspace,
    session: createSessionContext(),
    onOutput: () => {},
    onChecklist: () => {},
  };
}

function writeProjectSkill(cwd: string, name: string, description: string, body: string): void {
  const dir = join(cwd, ".agents", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${body}`, "utf8");
}

beforeEach(() => resetSkillCache());
afterEach(cleanupDirs);

describe("skill-list", () => {
  test("returns bundled skills", async () => {
    const dir = createDir("acolyte-skill-list-");
    await loadSkills(dir);
    const toolkit = createSkillToolkit(createToolkitInput(dir));
    const { result } = (await toolkit.listSkills.execute({}, "call-1")) as { result: SkillListResult };
    expect(result.kind).toBe("skill-list");
    expect(result.skills.length).toBeGreaterThan(0);
    const build = result.skills.find((s) => s.name === "build");
    expect(build).toBeDefined();
    expect(build?.source).toBe("bundled");
  });

  test("returns project skills with source", async () => {
    const dir = createDir("acolyte-skill-list-proj-");
    writeProjectSkill(dir, "deploy", "Deploy to prod", "# Deploy\nRun deploy.");
    await loadSkills(dir);
    const toolkit = createSkillToolkit(createToolkitInput(dir));
    const { result } = (await toolkit.listSkills.execute({}, "call-2")) as { result: SkillListResult };
    const deploy = result.skills.find((s) => s.name === "deploy");
    expect(deploy).toBeDefined();
    expect(deploy?.source).toBe("project");
  });

  test("includes both bundled and project skills", async () => {
    const dir = createDir("acolyte-skill-list-both-");
    writeProjectSkill(dir, "deploy", "Deploy to prod", "# Deploy\nRun deploy.");
    await loadSkills(dir);
    const toolkit = createSkillToolkit(createToolkitInput(dir));
    const { result } = (await toolkit.listSkills.execute({}, "call-3")) as { result: SkillListResult };
    const sources = new Set(result.skills.map((s) => s.source));
    expect(sources.has("bundled")).toBe(true);
    expect(sources.has("project")).toBe(true);
  });
});

describe("skill-activate", () => {
  test("returns instructions for bundled skill and sets session activeSkill", async () => {
    const dir = createDir("acolyte-skill-activate-");
    await loadSkills(dir);
    const input = createToolkitInput(dir);
    const toolkit = createSkillToolkit(input);
    const { result } = (await toolkit.activateSkill.execute({ name: "build" }, "call-4")) as {
      result: SkillActivateResult;
    };
    expect(result.kind).toBe("skill-activate");
    expect(result.name).toBe("build");
    expect(result.source).toBe("bundled");
    expect(result.instructions.length).toBeGreaterThan(0);
    expect(input.session.activeSkill).toEqual({ name: "build", instructions: result.instructions });
  });

  test("returns instructions for project skill", async () => {
    const dir = createDir("acolyte-skill-activate-proj-");
    writeProjectSkill(dir, "deploy", "Deploy to prod", "# Deploy\nRun the deploy script.");
    await loadSkills(dir);
    const toolkit = createSkillToolkit(createToolkitInput(dir));
    const { result } = (await toolkit.activateSkill.execute({ name: "deploy" }, "call-5")) as {
      result: SkillActivateResult;
    };
    expect(result.name).toBe("deploy");
    expect(result.source).toBe("project");
    expect(result.instructions).toContain("deploy script");
  });

  test("project skill overrides bundled skill with same name", async () => {
    const dir = createDir("acolyte-skill-override-");
    writeProjectSkill(dir, "build", "Custom build", "# Custom Build\nProject-specific build.");
    await loadSkills(dir);
    const toolkit = createSkillToolkit(createToolkitInput(dir));
    const { result } = (await toolkit.activateSkill.execute({ name: "build" }, "call-6")) as {
      result: SkillActivateResult;
    };
    expect(result.source).toBe("project");
    expect(result.instructions).toContain("Project-specific build");
  });

  test("throws for unknown skill", async () => {
    const dir = createDir("acolyte-skill-unknown-");
    await loadSkills(dir);
    const toolkit = createSkillToolkit(createToolkitInput(dir));
    await expect(toolkit.activateSkill.execute({ name: "nonexistent" }, "call-7")).rejects.toThrow("skill not found");
  });

  test("substitutes arguments in instructions", async () => {
    const dir = createDir("acolyte-skill-args-");
    writeProjectSkill(dir, "greet", "Greet someone", "# Greet\nHello $ARGUMENTS!");
    await loadSkills(dir);
    const toolkit = createSkillToolkit(createToolkitInput(dir));
    const { result } = (await toolkit.activateSkill.execute({ name: "greet", args: "world" }, "call-8")) as {
      result: SkillActivateResult;
    };
    expect(result.instructions).toContain("Hello world!");
  });
});
