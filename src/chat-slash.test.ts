import { afterEach, describe, expect, test } from "bun:test";
import { isKnownSlashToken, shouldAutocompleteSlashSubmit, slashCommandHelp, suggestSlashCommands } from "./chat-slash";
import { loadSkills, resetSkillCache } from "./skills";
import { tempDir, writeSkill } from "./test-utils";

describe("chat-slash helpers", () => {
  test("suggestSlashCommands filters known commands by prefix", () => {
    expect(suggestSlashCommands("/c")).toEqual([]);
    expect(suggestSlashCommands("/p")).toEqual(["/permissions", "/permissions read", "/permissions write"]);
    expect(suggestSlashCommands("/s")).toEqual(["/status", "/sessions", "/skills"]);
    expect(suggestSlashCommands("/st")).toEqual(["/status"]);
    expect(suggestSlashCommands("/d")).toEqual([]);
    expect(suggestSlashCommands("/memo")).toEqual([
      "/memory",
      "/memory list",
      "/memory add",
      "/memory all",
      "/memory user",
    ]);
    expect(suggestSlashCommands("/memory l")).toEqual(["/memory list"]);
    expect(suggestSlashCommands("/memory p")).toEqual(["/memory project"]);
    expect(suggestSlashCommands("/memory a")).toEqual(["/memory add", "/memory all"]);
    expect(suggestSlashCommands("/memory u")).toEqual(["/memory user"]);
    expect(suggestSlashCommands("/permissions r")).toEqual(["/permissions read"]);
    expect(suggestSlashCommands("/mo")).toEqual([
      "/model",
      "/model plan",
      "/model work",
      "/model verify",
      "/model chat",
    ]);
    expect(suggestSlashCommands("/mod")).toEqual([
      "/model",
      "/model plan",
      "/model work",
      "/model verify",
      "/model chat",
    ]);
    expect(suggestSlashCommands("/model c")).toEqual(["/model chat"]);
    expect(suggestSlashCommands("/reme")).toEqual(["/remember"]);
    expect(suggestSlashCommands("/unknown")).toEqual([]);
    expect(suggestSlashCommands("plain")).toEqual([]);
  });

  test("suggestSlashCommands falls back to fuzzy matching for typos", () => {
    expect(suggestSlashCommands("/stauts")).toEqual(["/status"]);
    expect(suggestSlashCommands("/neew")).toEqual(["/new"]);
    expect(suggestSlashCommands("/sesions")).toEqual(["/sessions"]);
    expect(suggestSlashCommands("/xyzxyz")).toEqual([]);
  });

  test("shouldAutocompleteSlashSubmit only intercepts unresolved slash command token", () => {
    expect(shouldAutocompleteSlashSubmit("/st", "/status")).toBe(true);
    expect(shouldAutocompleteSlashSubmit("/model p", "/model plan")).toBe(true);
    expect(shouldAutocompleteSlashSubmit("/status", "/status")).toBe(false);
    expect(shouldAutocompleteSlashSubmit("/model plan", "/model plan")).toBe(false);
    expect(shouldAutocompleteSlashSubmit("/status now", "/status")).toBe(false);
    expect(shouldAutocompleteSlashSubmit("status", "/status")).toBe(false);
  });

  test("isKnownSlashToken recognizes canonical tokens and subcommands", () => {
    expect(isKnownSlashToken("/status")).toBe(true);
    expect(isKnownSlashToken("/model")).toBe(true);
    expect(isKnownSlashToken("/model plan")).toBe(true);
    expect(isKnownSlashToken("/memory list")).toBe(true);
    expect(isKnownSlashToken("/unknown")).toBe(false);
  });

  test("slashCommandHelp returns short descriptions", () => {
    expect(slashCommandHelp("/model")).toBe("change model");
    expect(slashCommandHelp("/permissions write")).toBe("set permissions to write");
    expect(slashCommandHelp("/unknown")).toBe("");
  });

  describe("with loaded skills", () => {
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
});
