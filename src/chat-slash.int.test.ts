import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { shortcutItems } from "./chat-layout";
import { isKnownSlashToken, suggestSlashCommands } from "./chat-slash";
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

    const suggestions = suggestSlashCommands("/dog");
    expect(suggestions).toContain("/dogfood");
  });

  test("a skill is offered as a completion but stays out of the help pane", async () => {
    const tmpDir = createDir("acolyte-slash-pane-");
    writeSkill(tmpDir, "dogfood", "---\nname: dogfood\ndescription: Test\n---", "# Test");
    await loadSkills(tmpDir);

    expect(suggestSlashCommands("/dog")).toContain("/dogfood");
    expect(shortcutItems().some((item) => item.key === "/dogfood")).toBe(false);
  });

  test("isKnownSlashToken recognizes skill names", async () => {
    const tmpDir = createDir("acolyte-slash-known-");
    writeSkill(tmpDir, "dogfood", "---\nname: dogfood\ndescription: Test\n---", "# Test");
    await loadSkills(tmpDir);

    expect(isKnownSlashToken("/dogfood")).toBe(true);
    expect(isKnownSlashToken("/nonexistent")).toBe(false);
  });
});
