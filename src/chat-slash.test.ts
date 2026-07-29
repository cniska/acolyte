import { beforeEach, describe, expect, test } from "bun:test";
import { appConfig } from "./app-config";
import {
  chatSlashCommands,
  isKnownSlashToken,
  shouldAutocompleteSlashSubmit,
  slashCommandHelp,
  suggestSlashCommands,
} from "./chat-slash";
import { resetSkillCache } from "./skill-ops";

function setWorkspacesEnabled(enabled: boolean): () => void {
  const cfg = appConfig as unknown as { features: { workspaces: boolean } };
  const prev = cfg.features.workspaces;
  cfg.features.workspaces = enabled;
  return () => {
    cfg.features.workspaces = prev;
  };
}

beforeEach(() => resetSkillCache());

describe("chat-slash helpers", () => {
  test("suggestSlashCommands filters known commands by prefix", () => {
    expect(suggestSlashCommands("/c")).toEqual(["/clear"]);
    expect(suggestSlashCommands("/p")).toEqual([]);
    expect(suggestSlashCommands("/s")).toEqual(["/status", "/sessions", "/skills"]);
    expect(suggestSlashCommands("/st")).toEqual(["/status"]);
    expect(suggestSlashCommands("/d")).toEqual([]);
    expect(suggestSlashCommands("/memo")).toEqual([
      "/memory",
      "/memory add",
      "/memory rm",
      "/memory list",
      "/memory all",
    ]);
    expect(suggestSlashCommands("/memory l")).toEqual(["/memory list"]);
    expect(suggestSlashCommands("/memory p")).toEqual(["/memory project"]);
    expect(suggestSlashCommands("/memory a")).toEqual(["/memory add", "/memory all"]);
    expect(suggestSlashCommands("/memory u")).toEqual(["/memory user"]);
    expect(suggestSlashCommands("/usa")).toEqual(["/usage"]);
    expect(suggestSlashCommands("/mo")).toEqual(["/model"]);
    expect(suggestSlashCommands("/mod")).toEqual(["/model"]);
    expect(suggestSlashCommands("/memory a")).toEqual(["/memory add", "/memory all"]);
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
    const restore = setWorkspacesEnabled(true);
    try {
      expect(suggestSlashCommands("/mov")).toEqual([
        "/model",
        "/workspaces",
        "/workspaces list",
        "/workspaces new",
        "/workspaces switch",
      ]);
    } finally {
      restore();
    }
    expect(suggestSlashCommands("/modle")).toEqual(["/model"]);
    expect(suggestSlashCommands("/memry")).toEqual([
      "/memory",
      "/memory add",
      "/memory rm",
      "/memory list",
      "/memory all",
    ]);
  });

  test("workspaces commands are absent while the flag is off", () => {
    const restore = setWorkspacesEnabled(false);
    try {
      expect(chatSlashCommands()).not.toContain("/workspaces");
      expect(suggestSlashCommands("/w")).toEqual([]);
      expect(suggestSlashCommands("/workspaces")).toEqual([]);
      expect(suggestSlashCommands("/mov")).not.toContain("/workspaces");
      expect(isKnownSlashToken("/workspaces")).toBe(false);
      expect(isKnownSlashToken("/workspaces list")).toBe(false);
    } finally {
      restore();
    }
  });

  test("workspaces commands are present while the flag is on", () => {
    const restore = setWorkspacesEnabled(true);
    try {
      expect(chatSlashCommands()).toContain("/workspaces");
      expect(suggestSlashCommands("/w")).toEqual([
        "/workspaces",
        "/workspaces list",
        "/workspaces new",
        "/workspaces switch",
      ]);
      expect(isKnownSlashToken("/workspaces")).toBe(true);
      expect(isKnownSlashToken("/workspaces list")).toBe(true);
    } finally {
      restore();
    }
  });

  test("suggestSlashCommands fuzzy-matches multi-token input", () => {
    expect(suggestSlashCommands("/model vreify")).toEqual([]);
    expect(suggestSlashCommands("/model wrk")).toEqual([]);
  });

  test("shouldAutocompleteSlashSubmit only intercepts unresolved slash command token", () => {
    expect(shouldAutocompleteSlashSubmit("/st", "/status")).toBe(true);
    expect(shouldAutocompleteSlashSubmit("/mo", "/model")).toBe(true);
    expect(shouldAutocompleteSlashSubmit("/stauts", "/status")).toBe(true);
    expect(shouldAutocompleteSlashSubmit("/mov", "/model")).toBe(true);
    expect(shouldAutocompleteSlashSubmit("/status", "/status")).toBe(false);
    expect(shouldAutocompleteSlashSubmit("/model", "/model")).toBe(false);
    expect(shouldAutocompleteSlashSubmit("/status now", "/status")).toBe(false);
    expect(shouldAutocompleteSlashSubmit("status", "/status")).toBe(false);
  });

  test("isKnownSlashToken recognizes canonical tokens and subcommands", () => {
    expect(isKnownSlashToken("/status")).toBe(true);
    expect(isKnownSlashToken("/usage")).toBe(true);
    expect(isKnownSlashToken("/model")).toBe(true);
    expect(isKnownSlashToken("/model work")).toBe(false);
    expect(isKnownSlashToken("/memory list")).toBe(true);
    expect(isKnownSlashToken("/unknown")).toBe(false);
  });

  test("slashCommandHelp returns short descriptions", () => {
    expect(slashCommandHelp("/model")).toBe("change model");
    expect(slashCommandHelp("/model work")).toBe("");
    expect(slashCommandHelp("/unknown")).toBe("");
  });
});
