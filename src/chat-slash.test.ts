import { afterEach, describe, expect, test } from "bun:test";
import {
  applySlashSuggestion,
  isKnownSlashToken,
  resolveSlashAlias,
  shouldAutocompleteSlashSubmit,
  slashCommandHelp,
  suggestClosestSlashCommand,
  suggestSlashCommands,
} from "./chat-slash";
import { loadSkills, resetSkillCache } from "./skills";
import { tempDir, writeSkill } from "./test-utils";

describe("chat-slash helpers", () => {
  test("suggestSlashCommands filters known commands by prefix", () => {
    expect(suggestSlashCommands("/c")).toEqual([]);
    expect(suggestSlashCommands("/p")).toEqual(["/permissions"]);
    expect(suggestSlashCommands("/s")).toEqual(["/status", "/sessions", "/skills"]);
    expect(suggestSlashCommands("/st")).toEqual(["/status"]);
    expect(suggestSlashCommands("/d")).toEqual([]);
    expect(suggestSlashCommands("/mem")).toEqual(["/mem", "/memory"]);
    expect(suggestSlashCommands("/memory ")).toEqual([
      "/memory list",
      "/memory add",
      "/memory all",
      "/memory user",
      "/memory project",
    ]);
    expect(suggestSlashCommands("/memory p")).toEqual(["/memory project"]);
    expect(suggestSlashCommands("/memory a")).toEqual(["/memory add", "/memory all"]);
    expect(suggestSlashCommands("/mem u")).toEqual(["/memory user"]);
    expect(suggestSlashCommands("/permissions ")).toEqual(["/permissions read", "/permissions write"]);
    expect(suggestSlashCommands("/permissions r")).toEqual(["/permissions read"]);
    expect(suggestSlashCommands("/mo")).toEqual(["/model"]);
    expect(suggestSlashCommands("/mod")).toEqual(["/model", "/model plan", "/model work", "/model verify"]);
    expect(suggestSlashCommands("/mode")).toEqual(["/model", "/model plan", "/model work", "/model verify"]);
    expect(suggestSlashCommands("/rem")).toEqual(["/rem", "/remember"]);
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

  test("applySlashSuggestion appends trailing space", () => {
    expect(applySlashSuggestion("/status")).toBe("/status ");
  });

  test("resolveSlashAlias maps bare and argument forms", () => {
    expect(resolveSlashAlias("/session")).toBe("/sessions");
    expect(resolveSlashAlias("/mem")).toBe("/memory");
    expect(resolveSlashAlias("/mem user")).toBe("/memory user");
    expect(resolveSlashAlias("/mem project")).toBe("/memory project");
    expect(resolveSlashAlias("/rem fix naming")).toBe("/remember fix naming");
    expect(resolveSlashAlias("plain")).toBe("plain");
  });

  test("resolveSlashAlias keeps unknown aliases unchanged", () => {
    expect(resolveSlashAlias("/xyz")).toBe("/xyz");
    expect(resolveSlashAlias("/not-a-command arg")).toBe("/not-a-command arg");
  });

  test("isKnownSlashToken recognizes canonical and alias tokens", () => {
    expect(isKnownSlashToken("/status")).toBe(true);
    expect(isKnownSlashToken("/model")).toBe(true);
    expect(isKnownSlashToken("/session")).toBe(true);
    expect(isKnownSlashToken("/unknown")).toBe(false);
  });

  test("slashCommandHelp returns short descriptions", () => {
    expect(slashCommandHelp("/model")).toBe("change model");
    expect(slashCommandHelp("/permissions write")).toBe("set permissions to write");
    expect(slashCommandHelp("/unknown")).toBe("");
  });

  test("suggestClosestSlashCommand finds nearest known command for typos", () => {
    expect(suggestClosestSlashCommand("/stauts")).toBe("/status");
    expect(suggestClosestSlashCommand("/status")).toBeNull();
    expect(suggestClosestSlashCommand("plain")).toBeNull();
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
