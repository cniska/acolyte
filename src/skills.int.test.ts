import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLED_SKILLS } from "./bundled-skills";
import { listSkills, readSkillInstructions } from "./skills";
import { tempDir, writeSkill } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

const BUNDLED_COUNT = BUNDLED_SKILLS.length;

describe("skills loader", () => {
  test("returns only bundled skills when no project skills exist", async () => {
    const dir = createDir("acolyte-skills-empty-");
    const skills = await listSkills(dir);
    expect(skills).toHaveLength(BUNDLED_COUNT);
    expect(skills.every((s) => s.source === "bundled")).toBe(true);
  });

  test("reads name/description from SKILL.md frontmatter", async () => {
    const dir = createDir("acolyte-skills-one-");
    writeSkill(dir, "demo", "---\nname: demo\ndescription: Demo description\n---", "# Demo");
    const skills = await listSkills(dir);
    expect(skills).toHaveLength(BUNDLED_COUNT + 1);
    const demo = skills.find((s) => s.name === "demo");
    expect(demo?.name).toBe("demo");
    expect(demo?.description).toBe("Demo description");
    expect(demo?.source).toBe("project");
  });

  test("scans .agents/skills/ directory", async () => {
    const dir = createDir("acolyte-skills-agents-");
    const skillDir = join(dir, ".agents", "skills", "helper");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: helper\ndescription: Helper skill\n---\n# Help", "utf8");
    const skills = await listSkills(dir);
    const helper = skills.find((s) => s.name === "helper");
    expect(helper).toBeDefined();
    expect(helper?.source).toBe("project");
  });

  test("only scans .agents/skills directory", async () => {
    const dir = createDir("acolyte-skills-scope-");
    const ignoredDir = join(dir, "skills", "demo");
    mkdirSync(ignoredDir, { recursive: true });
    writeFileSync(join(ignoredDir, "SKILL.md"), "---\nname: demo\ndescription: From skills/\n---", "utf8");
    const agentDir = join(dir, ".agents", "skills", "demo");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "SKILL.md"), "---\nname: demo\ndescription: From .agents/skills/\n---", "utf8");
    const skills = await listSkills(dir);
    const demo = skills.find((s) => s.name === "demo");
    expect(demo?.description).toBe("From .agents/skills/");
  });

  test("skips skills with invalid names", async () => {
    const dir = createDir("acolyte-skills-invalid-");
    writeSkill(dir, "Bad-Name", "---\nname: Bad-Name\ndescription: Invalid\n---");
    writeSkill(dir, "good", "---\nname: good\ndescription: Valid\n---");
    const skills = await listSkills(dir);
    const projectSkills = skills.filter((s) => s.source === "project");
    expect(projectSkills).toHaveLength(1);
    expect(projectSkills[0]?.name).toBe("good");
  });

  test("skips skills where name mismatches directory", async () => {
    const dir = createDir("acolyte-skills-mismatch-");
    writeSkill(dir, "foo", "---\nname: bar\ndescription: Mismatched\n---");
    const skills = await listSkills(dir);
    expect(skills.filter((s) => s.source === "project")).toHaveLength(0);
  });

  test("parses optional fields: license, compatibility, metadata, allowed-tools", async () => {
    const dir = createDir("acolyte-skills-optional-");
    const fm = [
      "---",
      "name: full",
      "description: Full spec skill",
      "license: MIT",
      "compatibility: Requires git",
      "allowed-tools: Bash Read Write",
      "metadata:",
      "  author: test-org",
      '  version: "1.0"',
      "---",
    ].join("\n");
    writeSkill(dir, "full", fm);
    const skills = await listSkills(dir);
    const full = skills.find((s) => s.name === "full");
    expect(full?.license).toBe("MIT");
    expect(full?.compatibility).toBe("Requires git");
    expect(full?.allowedTools).toEqual(["Bash", "Read", "Write"]);
    expect(full?.metadata).toEqual({ author: "test-org", version: "1.0" });
  });

  test("project skill overrides bundled skill with same name", async () => {
    const dir = createDir("acolyte-skills-override-");
    writeSkill(dir, "build", "---\nname: build\ndescription: Custom build\n---", "# Custom");
    const skills = await listSkills(dir);
    const build = skills.find((s) => s.name === "build");
    expect(build?.source).toBe("project");
    expect(build?.description).toBe("Custom build");
  });
});

describe("readSkillInstructions", () => {
  test("strips frontmatter and returns body", async () => {
    const dir = createDir("acolyte-skills-body-");
    const file = join(dir, "SKILL.md");
    writeFileSync(file, "---\nname: demo\ndescription: Demo\n---\n\n# Demo\nUse this skill.", "utf8");
    const body = await readSkillInstructions(file);
    expect(body).toBe("# Demo\nUse this skill.");
  });

  test("substitutes $ARGUMENTS when args provided", async () => {
    const dir = createDir("acolyte-skills-args-");
    const file = join(dir, "SKILL.md");
    writeFileSync(file, "---\nname: demo\ndescription: Demo\n---\n\nDo: $ARGUMENTS", "utf8");
    const body = await readSkillInstructions(file, "run tests");
    expect(body).toBe("Do: run tests");
  });

  test("cleans $ARGUMENTS placeholder when args is empty string", async () => {
    const dir = createDir("acolyte-skills-empty-args-");
    const file = join(dir, "SKILL.md");
    writeFileSync(file, "---\nname: demo\ndescription: Demo\n---\n\nDo: $ARGUMENTS", "utf8");
    const body = await readSkillInstructions(file, "");
    expect(body).toBe("Do: ");
  });
});
