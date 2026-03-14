import { afterEach, describe, expect, test } from "bun:test";
import { isKnownSlashToken, shouldAutocompleteSlashSubmit, slashCommandHelp, suggestSlashCommands } from "./chat-slash";
import { loadSkills, resetSkillCache } from "./skills";
import { tempDir, writeSkill } from "./test-utils";

describe("chat-slash helpers", () => {
  test("suggestSlashCommands filters known commands by prefix", () => {
    expect(suggestSlashCommands("/c")).toEqual(["/clear"]);
    expect(suggestSlashCommands("/p")).toEqual([]);
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
    expect(suggestSlashCommands("/usa")).toEqual(["/usage"]);
    expect(suggestSlashCommands("/mo")).toEqual(["/model", "/model work", "/model verify"]);
    expect(suggestSlashCommands("/mod")).toEqual(["/model", "/model work", "/model verify"]);
    expect(suggestSlashCommands("/reme")).toEqual(["/remember"]);
    expect(suggestSlashCommands("/unknown")).toEqual([]);
    expect(suggestSlashCommands("plain")).toEqual([]);
  });

  test("suggestSlashCommands falls back to fuzzy matching for typos", () => {
    expect(suggestSlashCommands("/stauts")).toEqual(["/status"]);
    expect(suggestSlashCommands("/neew")).toContain("/new");
    expect(suggestSlashCommands("/neew")[0]).toBe("/new");
    expect(suggestSlashCommands("/sesions")).toEqual(["/sessions"]);
    expect(suggestSlashCommands("/xyzxyz")).toEqual([]);
  });

  test("suggestSlashCommands fuzzy-matches root and expands subcommands", () => {
    expect(suggestSlashCommands("/mov")).toEqual(["/model", "/model work", "/model verify", "/memory", "/memory list"]);
    expect(suggestSlashCommands("/modle")).toEqual(["/model", "/model work", "/model verify"]);
    expect(suggestSlashCommands("/memry")).toEqual([
      "/memory",
      "/memory list",
      "/memory add",
      "/memory all",
      "/memory user",
    ]);
  });

  test("suggestSlashCommands fuzzy-matches multi-token input", () => {
    expect(suggestSlashCommands("/model vreify")).toEqual(["/model verify"]);
    expect(suggestSlashCommands("/model wrk")).toEqual(["/model work"]);
  });

  test("shouldAutocompleteSlashSubmit only intercepts unresolved slash command token", () => {
    expect(shouldAutocompleteSlashSubmit("/st", "/status")).toBe(true);
    expect(shouldAutocompleteSlashSubmit("/model w", "/model work")).toBe(true);
    expect(shouldAutocompleteSlashSubmit("/stauts", "/status")).toBe(true);
    expect(shouldAutocompleteSlashSubmit("/mov", "/model verify")).toBe(true);
    expect(shouldAutocompleteSlashSubmit("/status", "/status")).toBe(false);
    expect(shouldAutocompleteSlashSubmit("/model work", "/model work")).toBe(false);
    expect(shouldAutocompleteSlashSubmit("/status now", "/status")).toBe(false);
    expect(shouldAutocompleteSlashSubmit("status", "/status")).toBe(false);
  });

  test("isKnownSlashToken recognizes canonical tokens and subcommands", () => {
    expect(isKnownSlashToken("/status")).toBe(true);
    expect(isKnownSlashToken("/usage")).toBe(true);
    expect(isKnownSlashToken("/model")).toBe(true);
    expect(isKnownSlashToken("/model work")).toBe(true);
    expect(isKnownSlashToken("/memory list")).toBe(true);
    expect(isKnownSlashToken("/unknown")).toBe(false);
  });

  test("slashCommandHelp returns short descriptions", () => {
    expect(slashCommandHelp("/model")).toBe("change model");
    expect(slashCommandHelp("/model work")).toBe("change work model");
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
