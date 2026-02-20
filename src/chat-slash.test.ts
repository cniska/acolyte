import { describe, expect, test } from "bun:test";
import { applySlashSuggestion, resolveSlashAlias, shouldAutocompleteSlashSubmit, suggestSlashCommands } from "./chat-slash";

describe("chat-slash helpers", () => {
  test("suggestSlashCommands filters known commands by prefix", () => {
    expect(suggestSlashCommands("/c")).toEqual(["/changes"]);
    expect(suggestSlashCommands("/f")).toEqual(["/features"]);
    expect(suggestSlashCommands("/s")).toEqual(["/status", "/sessions", "/skills"]);
    expect(suggestSlashCommands("/st")).toEqual(["/status"]);
    expect(suggestSlashCommands("/d")).toEqual(["/dogfood", "/df", "/ds", "/dogfood-status"]);
    expect(suggestSlashCommands("/dogfood-s")).toEqual(["/dogfood-status"]);
    expect(suggestSlashCommands("/mem")).toEqual(["/mem", "/memories"]);
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
    expect(resolveSlashAlias("/df")).toBe("/dogfood");
    expect(resolveSlashAlias("/ds")).toBe("/dogfood-status");
    expect(resolveSlashAlias("/mem")).toBe("/memories");
    expect(resolveSlashAlias("/rem fix naming")).toBe("/remember fix naming");
    expect(resolveSlashAlias("plain")).toBe("plain");
  });
});
