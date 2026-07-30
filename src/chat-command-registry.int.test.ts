import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BUNDLED_SKILLS } from "./bundled-skills";
import { findCommandEntry, resolveCommandRegistry } from "./chat-command-registry";
import { getSkillLoadDiagnostics, loadSkills, resetSkillCache } from "./skill-ops";
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
  test("a project skill takes a builtin name", async () => {
    const cwd = createDir("acolyte-registry-shadow-");
    writeSkill(cwd, "new", "---\nname: new\ndescription: Mine\n---", "# Mine");
    await loadSkills(cwd);

    const entry = findCommandEntry("new");
    expect(entry?.spec.source).toBe("project");
    expect(resolveCommandRegistry().filter((item) => item.spec.name === "new")).toHaveLength(1);
  });

  test("a user skill is reachable as a command", async () => {
    const home = createDir("acolyte-registry-user-");
    process.env.HOME = home;
    writeSkill(home, "globaldemo", "---\nname: globaldemo\ndescription: User scope\n---", "# User");
    await loadSkills(createDir("acolyte-registry-cwd-"));

    expect(findCommandEntry("globaldemo")?.spec.source).toBe("user");
  });

  test("a bundled skill never takes a builtin name", async () => {
    await loadSkills(createDir("acolyte-registry-bundled-"));

    for (const bundled of BUNDLED_SKILLS) {
      const entry = findCommandEntry(bundled.name);
      if (entry) expect(entry.spec.source).toBe("bundled");
    }
    expect(findCommandEntry("new")?.spec.source).toBe("builtin");
    expect(getSkillLoadDiagnostics().builtinCollisions).toBe(0);
  });

  test("every registry name resolves to exactly one entry", async () => {
    const cwd = createDir("acolyte-registry-unique-");
    writeSkill(cwd, "review", "---\nname: review\ndescription: Mine\n---", "# Mine");
    await loadSkills(cwd);

    const names = resolveCommandRegistry().map((entry) => entry.spec.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
