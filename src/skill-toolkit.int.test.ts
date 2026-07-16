import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActiveSkill } from "./skill-contract";
import { loadSkills, resetSkillCache } from "./skill-ops";
import { createSkillToolkit } from "./skill-toolkit";
import { tempDir } from "./test-utils";
import type { ToolkitInput } from "./tool-contract";
import { createSessionContext } from "./tool-session";

type SkillActivateResult = { kind: string; activated: { name: string; source: string; instructions: string }[] };

const { createDir, cleanupDirs } = tempDir();

type OutputEvent = { toolName: string; content: unknown; toolCallId?: string };

function createToolkitInput(workspace: string, outputs?: OutputEvent[], activations?: ActiveSkill[]): ToolkitInput {
  return {
    workspace,
    session: createSessionContext(),
    onOutput: (event) => outputs?.push(event),
    onChecklist: () => {},
    onSkillActivated: (skill) => activations?.push(skill),
  };
}

function writeProjectSkill(cwd: string, name: string, description: string, body: string): void {
  const dir = join(cwd, ".agents", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${body}`, "utf8");
}

beforeEach(() => resetSkillCache());
afterEach(cleanupDirs);

describe("skill-activate", () => {
  test("activates bundled skill and sets session activeSkills", async () => {
    const dir = createDir("acolyte-skill-activate-");
    await loadSkills(dir);
    const input = createToolkitInput(dir);
    const toolkit = createSkillToolkit(input);
    const { result } = (await toolkit.activateSkill.execute({ names: ["build"] }, "call-4")) as {
      result: SkillActivateResult;
    };
    expect(result.kind).toBe("skill-activate");
    expect(result.activated).toHaveLength(1);
    expect(result.activated[0]?.name).toBe("build");
    expect(result.activated[0]?.source).toBe("bundled");
    expect(result.activated[0]?.instructions.length).toBeGreaterThan(0);
    expect(input.session.activeSkills).toEqual([{ name: "build", instructions: result.activated[0]?.instructions }]);
  });

  test("emits onSkillActivated for each activated skill", async () => {
    const dir = createDir("acolyte-skill-activate-emit-");
    await loadSkills(dir);
    const activations: ActiveSkill[] = [];
    const input = createToolkitInput(dir, undefined, activations);
    const toolkit = createSkillToolkit(input);
    await toolkit.activateSkill.execute({ names: ["build", "git"] }, "call-emit");
    expect(activations.map((s) => s.name)).toEqual(["build", "git"]);
    expect(activations[0]?.instructions.length).toBeGreaterThan(0);
  });

  test("activates project skill", async () => {
    const dir = createDir("acolyte-skill-activate-proj-");
    writeProjectSkill(dir, "deploy", "Deploy to prod", "# Deploy\nRun the deploy script.");
    await loadSkills(dir);
    const toolkit = createSkillToolkit(createToolkitInput(dir));
    const { result } = (await toolkit.activateSkill.execute({ names: ["deploy"] }, "call-5")) as {
      result: SkillActivateResult;
    };
    expect(result.activated[0]?.name).toBe("deploy");
    expect(result.activated[0]?.source).toBe("project");
    expect(result.activated[0]?.instructions).toContain("deploy script");
  });

  test("project skill overrides bundled skill with same name", async () => {
    const dir = createDir("acolyte-skill-override-");
    writeProjectSkill(dir, "build", "Custom build", "# Custom Build\nProject-specific build.");
    await loadSkills(dir);
    const toolkit = createSkillToolkit(createToolkitInput(dir));
    const { result } = (await toolkit.activateSkill.execute({ names: ["build"] }, "call-6")) as {
      result: SkillActivateResult;
    };
    expect(result.activated[0]?.source).toBe("project");
    expect(result.activated[0]?.instructions).toContain("Project-specific build");
  });

  test("throws for unknown skill", async () => {
    const dir = createDir("acolyte-skill-unknown-");
    await loadSkills(dir);
    const toolkit = createSkillToolkit(createToolkitInput(dir));
    await expect(toolkit.activateSkill.execute({ names: ["nonexistent"] }, "call-7")).rejects.toThrow(
      "skill not found",
    );
  });

  test("activates multiple skills in one call", async () => {
    const dir = createDir("acolyte-skill-activate-multi-");
    await loadSkills(dir);
    const input = createToolkitInput(dir);
    const toolkit = createSkillToolkit(input);
    const { result } = (await toolkit.activateSkill.execute({ names: ["build", "git"] }, "call-multi")) as {
      result: SkillActivateResult;
    };
    expect(result.activated).toHaveLength(2);
    expect(result.activated.map((s) => s.name)).toEqual(["build", "git"]);
    expect(input.session.activeSkills?.map((s) => s.name)).toEqual(["build", "git"]);
  });

  test("emits one tool-header row listing all activated skills", async () => {
    const dir = createDir("acolyte-skill-activate-output-");
    await loadSkills(dir);
    const outputs: OutputEvent[] = [];
    const input = createToolkitInput(dir, outputs);
    const toolkit = createSkillToolkit(input);
    await toolkit.activateSkill.execute({ names: ["build", "git"] }, "call-output");
    const headers = outputs.filter((o) => (o.content as { kind: string }).kind === "tool-header");
    expect(headers).toHaveLength(1);
    expect((headers[0]?.content as { detail: string }).detail).toBe("build, git");
  });

  test("activates nothing when any skill in the batch is unresolved", async () => {
    const dir = createDir("acolyte-skill-activate-partial-");
    await loadSkills(dir);
    const outputs: OutputEvent[] = [];
    const input = createToolkitInput(dir, outputs);
    const toolkit = createSkillToolkit(input);
    await expect(toolkit.activateSkill.execute({ names: ["build", "nonexistent"] }, "call-partial")).rejects.toThrow(
      'skill not found: "nonexistent"',
    );
    expect(input.session.activeSkills ?? []).toHaveLength(0);
    expect(outputs.filter((o) => (o.content as { kind: string }).kind === "tool-header")).toHaveLength(0);
  });

  test("substitutes arguments in instructions", async () => {
    const dir = createDir("acolyte-skill-args-");
    writeProjectSkill(dir, "greet", "Greet someone", "# Greet\nHello $ARGUMENTS!");
    await loadSkills(dir);
    const toolkit = createSkillToolkit(createToolkitInput(dir));
    const { result } = (await toolkit.activateSkill.execute({ names: ["greet"], args: "world" }, "call-8")) as {
      result: SkillActivateResult;
    };
    expect(result.activated[0]?.instructions).toContain("Hello world!");
  });
});
