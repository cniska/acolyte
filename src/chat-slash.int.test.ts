import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isKnownSlashToken, slashCommandHelp, suggestSlashCommands } from "./chat-slash";
import { loadSkills, resetSkillCache } from "./skill-ops";
import { tempDir, writeSkill } from "./test-utils";

beforeEach(() => resetSkillCache());

describe("chat-slash with loaded skills", () => {
  const { createDir, cleanupDirs } = tempDir();
  afterEach(() => {
    resetSkillCache();
    cleanupDirs();
  });

  test("skill names appear in suggestions", async () => {
    const tmpDir = createDir("acolyte-slash-skill-");
    writeSkill(tmpDir, "dogfood", "---\nname: dogfood\ndescription: Test\n---", "# Test");
    await loadSkills(tmpDir);

    const suggestions = suggestSlashCommands("/skill:dog");
    expect(suggestions).toContain("/skill:dogfood");
  });

  test("a skill is offered once", async () => {
    const tmpDir = createDir("acolyte-slash-once-");
    writeSkill(tmpDir, "dogfood", "---\nname: dogfood\ndescription: Test\n---", "# Test");
    await loadSkills(tmpDir);

    expect(suggestSlashCommands("/skill:dogfood", 20)).toEqual(["/skill:dogfood"]);
  });

  test("the skill prefix alone offers every skill and no builtin", async () => {
    const tmpDir = createDir("acolyte-slash-namespace-");
    writeSkill(tmpDir, "dogfood", "---\nname: dogfood\ndescription: Test\n---", "# Test");
    await loadSkills(tmpDir);

    const suggestions = suggestSlashCommands("/skill:", 50);
    expect(suggestions).toContain("/skill:dogfood");
    expect(suggestions.every((command) => command.startsWith("/skill:"))).toBe(true);
  });

  test("a skill's own name offers its prefixed command alone", async () => {
    const tmpDir = createDir("acolyte-slash-name-");
    writeSkill(tmpDir, "dogfood", "---\nname: dogfood\ndescription: Test\n---", "# Test");
    await loadSkills(tmpDir);

    expect(suggestSlashCommands("/dogfood", 20)).toEqual(["/skill:dogfood"]);
  });

  test("a skill's row carries its own description as help", async () => {
    const tmpDir = createDir("acolyte-slash-help-");
    writeSkill(tmpDir, "dogfood", "---\nname: dogfood\ndescription: Drive the live chat TUI\n---", "# Test");
    await loadSkills(tmpDir);

    expect(slashCommandHelp("/skill:dogfood")).toBe("Drive the live chat TUI");
  });

  test("a builtin name is never answered by a skill of that name", async () => {
    const tmpDir = createDir("acolyte-slash-builtin-");
    writeSkill(tmpDir, "status", "---\nname: status\ndescription: Test\n---", "# Test");
    await loadSkills(tmpDir);

    expect(suggestSlashCommands("/status", 20)).toEqual(["/status"]);
  });

  test("isKnownSlashToken recognizes a prefixed skill name only", async () => {
    const tmpDir = createDir("acolyte-slash-known-");
    writeSkill(tmpDir, "dogfood", "---\nname: dogfood\ndescription: Test\n---", "# Test");
    await loadSkills(tmpDir);

    expect(isKnownSlashToken("/skill:dogfood")).toBe(true);
    expect(isKnownSlashToken("/dogfood")).toBe(false);
  });
});
