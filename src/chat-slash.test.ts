import { describe, expect, test } from "bun:test";
import {
  applySlashSuggestion,
  isKnownSlashToken,
  resolveSlashAlias,
  shouldAutocompleteSlashSubmit,
  suggestClosestSlashCommand,
  suggestSlashCommands,
} from "./chat-slash";

describe("chat-slash helpers", () => {
  test("suggestSlashCommands filters known commands by prefix", () => {
    expect(suggestSlashCommands("/c")).toEqual([]);
    expect(suggestSlashCommands("/p")).toEqual(["/permissions"]);
    expect(suggestSlashCommands("/s")).toEqual(["/status", "/sessions", "/skills"]);
    expect(suggestSlashCommands("/st")).toEqual(["/status"]);
    expect(suggestSlashCommands("/d")).toEqual(["/distill"]);
    expect(suggestSlashCommands("/mem")).toEqual(["/mem", "/memory", "/memory context"]);
    expect(suggestSlashCommands("/memory ")).toEqual([
      "/memory all",
      "/memory user",
      "/memory project",
      "/memory context",
    ]);
    expect(suggestSlashCommands("/memory p")).toEqual(["/memory project"]);
    expect(suggestSlashCommands("/mem u")).toEqual(["/memory user"]);
    expect(suggestSlashCommands("/memory c")).toEqual(["/memory context"]);
    expect(suggestSlashCommands("/memory context ")).toEqual([
      "/memory context all",
      "/memory context user",
      "/memory context project",
    ]);
    expect(suggestSlashCommands("/memory context u")).toEqual(["/memory context user"]);
    expect(suggestSlashCommands("/mem context p")).toEqual(["/memory context project"]);
    expect(suggestSlashCommands("/rem")).toEqual(["/rem", "/remember"]);
    expect(suggestSlashCommands("/unknown")).toEqual([]);
    expect(suggestSlashCommands("plain")).toEqual([]);
  });

  test("shouldAutocompleteSlashSubmit only intercepts unresolved slash command token", () => {
    expect(shouldAutocompleteSlashSubmit("/st", "/status")).toBe(true);
    expect(shouldAutocompleteSlashSubmit("/status", "/status")).toBe(false);
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
    expect(resolveSlashAlias("/mem context")).toBe("/memory context");
    expect(resolveSlashAlias("/mem context user")).toBe("/memory context user");
    expect(resolveSlashAlias("/rem fix naming")).toBe("/remember fix naming");
    expect(resolveSlashAlias("plain")).toBe("plain");
  });

  test("resolveSlashAlias keeps unknown aliases unchanged", () => {
    expect(resolveSlashAlias("/xyz")).toBe("/xyz");
    expect(resolveSlashAlias("/not-a-command arg")).toBe("/not-a-command arg");
  });

  test("isKnownSlashToken recognizes canonical and alias tokens", () => {
    expect(isKnownSlashToken("/status")).toBe(true);
    expect(isKnownSlashToken("/session")).toBe(true);
    expect(isKnownSlashToken("/unknown")).toBe(false);
  });

  test("suggestClosestSlashCommand finds nearest known command for typos", () => {
    expect(suggestClosestSlashCommand("/stauts")).toBe("/status");
    expect(suggestClosestSlashCommand("/status")).toBeNull();
    expect(suggestClosestSlashCommand("plain")).toBeNull();
  });
});
