import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BUNDLED_SKILLS } from "./bundled-skills";
import { findCommandEntry, resolveCommandRegistry } from "./chat-command-registry";
import { loadSkills, resetSkillCache } from "./skill-ops";
import { tempDir, writeSkill } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
const originalHome = process.env.HOME;

beforeEach(() => {
  process.env.HOME = createDir("acolyte-registry-home-");
});

afterEach(() => {
  process.env.HOME = originalHome;
  resetSkillCache();
  cleanupDirs();
});

describe("registry with loaded skills", () => {
  test("a project skill named after a builtin leaves the builtin reachable", async () => {
    const cwd = createDir("acolyte-registry-shadow-");
    writeSkill(cwd, "new", "---\nname: new\ndescription: Mine\n---", "# Mine");
    await loadSkills(cwd);

    expect(findCommandEntry("new")?.spec.source).toBe("builtin");
    expect(findCommandEntry("skill:new")?.spec.source).toBe("project");
  });

  test("a user skill is reachable as a command", async () => {
    const home = createDir("acolyte-registry-user-");
    process.env.HOME = home;
    writeSkill(home, "globaldemo", "---\nname: globaldemo\ndescription: User scope\n---", "# User");
    await loadSkills(createDir("acolyte-registry-cwd-"));

    expect(findCommandEntry("skill:globaldemo")?.spec.source).toBe("user");
    expect(findCommandEntry("globaldemo")).toBeNull();
  });

  test("every bundled skill answers under the skill prefix", async () => {
    await loadSkills(createDir("acolyte-registry-bundled-"));

    for (const bundled of BUNDLED_SKILLS) {
      expect(findCommandEntry(`skill:${bundled.name}`)?.spec.source).toBe("bundled");
    }
    expect(findCommandEntry("build")).toBeNull();
  });

  test("every registry name resolves to exactly one entry", async () => {
    const cwd = createDir("acolyte-registry-unique-");
    writeSkill(cwd, "review", "---\nname: review\ndescription: Mine\n---", "# Mine");
    await loadSkills(cwd);

    const names = resolveCommandRegistry().map((entry) => entry.spec.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
