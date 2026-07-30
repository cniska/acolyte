import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLED_SKILLS } from "./bundled-skills";
import {
  findSkillByName,
  getSkillLoadDiagnostics,
  loadSkills,
  readSkillInstructions,
  resetSkillCache,
} from "./skill-ops";
import { tempDir, writeSkill } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
const originalHome = process.env.HOME;

// The loader reads ~/.agents/skills, so every case owns its home directory rather than the developer's.
beforeEach(() => {
  process.env.HOME = createDir("acolyte-skills-home-");
});

afterEach(() => {
  process.env.HOME = originalHome;
  resetSkillCache();
  cleanupDirs();
});

const BUNDLED_COUNT = BUNDLED_SKILLS.length;

describe("skills loader", () => {
  test("returns only bundled skills when no project skills exist", async () => {
    const dir = createDir("acolyte-skills-empty-");
    const skills = await loadSkills(dir);
    expect(skills).toHaveLength(BUNDLED_COUNT);
    expect(skills.every((s) => s.source === "bundled")).toBe(true);
  });

  test("reads name/description from SKILL.md frontmatter", async () => {
    const dir = createDir("acolyte-skills-one-");
    writeSkill(dir, "demo", "---\nname: demo\ndescription: Demo description\n---", "# Demo");
    const skills = await loadSkills(dir);
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
    const skills = await loadSkills(dir);
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
    const skills = await loadSkills(dir);
    const demo = skills.find((s) => s.name === "demo");
    expect(demo?.description).toBe("From .agents/skills/");
  });

  test("skips skills with invalid names", async () => {
    const dir = createDir("acolyte-skills-invalid-");
    writeSkill(dir, "Bad-Name", "---\nname: Bad-Name\ndescription: Invalid\n---");
    writeSkill(dir, "good", "---\nname: good\ndescription: Valid\n---");
    const skills = await loadSkills(dir);
    const projectSkills = skills.filter((s) => s.source === "project");
    expect(projectSkills).toHaveLength(1);
    expect(projectSkills[0]?.name).toBe("good");
  });

  test("skips skills where name mismatches directory", async () => {
    const dir = createDir("acolyte-skills-mismatch-");
    writeSkill(dir, "foo", "---\nname: bar\ndescription: Mismatched\n---");
    const skills = await loadSkills(dir);
    expect(skills.filter((s) => s.source === "project")).toHaveLength(0);
  });

  test("project skill overrides bundled skill with same name", async () => {
    const dir = createDir("acolyte-skills-override-");
    writeSkill(dir, "build", "---\nname: build\ndescription: Custom build\n---", "# Custom");
    const skills = await loadSkills(dir);
    const build = skills.find((s) => s.name === "build");
    expect(build?.source).toBe("project");
    expect(build?.description).toBe("Custom build");
  });

  test("renamed and newly added bundled skills resolve and invoke", async () => {
    const dir = createDir("acolyte-skills-taxonomy-");
    await loadSkills(dir);
    for (const name of [
      "correctness-review",
      "architecture-review",
      "security-review",
      "style-review",
      "test-review",
      "doc-review",
      "agents-md",
    ]) {
      expect(findSkillByName(name)?.source).toBe("bundled");
      const body = await readSkillInstructions(`bundled://${name}`);
      expect(body.startsWith("---")).toBe(false);
      expect(body.length).toBeGreaterThan(0);
    }
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

describe("skill scopes", () => {
  test("discovers a user skill from the home directory", async () => {
    const home = createDir("acolyte-skills-user-");
    process.env.HOME = home;
    writeSkill(home, "globaldemo", "---\nname: globaldemo\ndescription: User scope\n---", "# User");

    const skills = await loadSkills(createDir("acolyte-skills-cwd-"));
    const found = skills.find((s) => s.name === "globaldemo");
    expect(found?.source).toBe("user");
    expect(found?.description).toBe("User scope");
  });

  test("a project skill wins the name and the user copy counts as a duplicate", async () => {
    const home = createDir("acolyte-skills-user-dup-");
    process.env.HOME = home;
    writeSkill(home, "shared", "---\nname: shared\ndescription: User copy\n---", "# User");
    const cwd = createDir("acolyte-skills-project-dup-");
    writeSkill(cwd, "shared", "---\nname: shared\ndescription: Project copy\n---", "# Project");

    const skills = await loadSkills(cwd);
    const shared = skills.filter((s) => s.name === "shared");
    expect(shared).toHaveLength(1);
    expect(shared[0].source).toBe("project");
    expect(shared[0].description).toBe("Project copy");
    expect(getSkillLoadDiagnostics().duplicates).toBe(1);
  });

  test("a scanned skill replacing a bundled one is counted", async () => {
    const cwd = createDir("acolyte-skills-override-");
    const bundledName = BUNDLED_SKILLS[0].name;
    writeSkill(cwd, bundledName, `---\nname: ${bundledName}\ndescription: Mine\n---`, "# Mine");

    const skills = await loadSkills(cwd);
    const replaced = skills.filter((s) => s.name === bundledName);
    expect(replaced).toHaveLength(1);
    expect(replaced[0].source).toBe("project");
    expect(getSkillLoadDiagnostics().overrides).toBe(1);
  });
});
