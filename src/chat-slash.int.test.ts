import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isKnownSlashToken, suggestSlashCommands } from "./chat-slash";
import { loadSkills, resetSkillCache } from "./skills";
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

    const suggestions = suggestSlashCommands("/dog");
    expect(suggestions).toContain("/dogfood");
  });

  test("isKnownSlashToken recognizes skill names", async () => {
    const tmpDir = createDir("acolyte-slash-known-");
    writeSkill(tmpDir, "dogfood", "---\nname: dogfood\ndescription: Test\n---", "# Test");
    await loadSkills(tmpDir);

    expect(isKnownSlashToken("/dogfood")).toBe(true);
    expect(isKnownSlashToken("/nonexistent")).toBe(false);
  });
});
