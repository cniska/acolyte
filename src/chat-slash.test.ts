import { beforeEach, describe, expect, test } from "bun:test";
import { appConfig } from "./app-config";
import {
  isKnownSlashToken,
  shouldAutocompleteSlashSubmit,
  slashCommandHelp,
  slashCommandRows,
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
    expect(suggestSlashCommands("/memo")).toEqual(["/memory", "/memory rm", "/memory list"]);
    expect(suggestSlashCommands("/memory l")).toEqual(["/memory list"]);
    expect(suggestSlashCommands("/usa")).toEqual(["/usage"]);
    expect(suggestSlashCommands("/mo")).toEqual(["/model"]);
    expect(suggestSlashCommands("/mod")).toEqual(["/model"]);
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
      expect(suggestSlashCommands("/wokspaces")).toEqual([
        "/workspaces",
        "/workspaces list",
        "/workspaces new",
        "/workspaces switch",
      ]);
      expect(suggestSlashCommands("/mov")).toEqual(["/model"]);
    } finally {
      restore();
    }
    expect(suggestSlashCommands("/modle")).toEqual(["/model"]);
    expect(suggestSlashCommands("/memry")).toEqual(["/memory", "/memory rm", "/memory list"]);
  });

  test("workspaces commands are absent while the flag is off", () => {
    const restore = setWorkspacesEnabled(false);
    try {
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

  test("every suggested command is a command the dispatcher owns", () => {
    const restore = setWorkspacesEnabled(true);
    try {
      const queries = ["/", "/m", "/me", "/memory ", "/w", "/s", "/stauts", "/memry", "/mov"];
      for (const query of queries) {
        for (const suggestion of suggestSlashCommands(query, 20)) {
          expect(isKnownSlashToken(suggestion)).toBe(true);
        }
      }
    } finally {
      restore();
    }
  });

  test("every declared help key resolves to a message", () => {
    const restore = setWorkspacesEnabled(true);
    try {
      for (const row of slashCommandRows()) {
        expect(row.help).not.toBe("");
        expect(row.help.startsWith("chat.slash.help")).toBe(false);
      }
    } finally {
      restore();
    }
  });

  test("a root offers exactly its declared subcommands", () => {
    const restore = setWorkspacesEnabled(true);
    try {
      const offered = slashCommandRows()
        .map((row) => row.command)
        .filter((command) => command.startsWith("/memory"));
      expect(offered).toEqual(["/memory", "/memory rm", "/memory list"]);
    } finally {
      restore();
    }
  });

  test("a root that owns subcommands offers no argument form of its own", () => {
    const restore = setWorkspacesEnabled(true);
    try {
      const rows = slashCommandRows();
      const roots = rows.filter((row) => !row.command.includes(" "));
      for (const root of roots) {
        const hasSubcommands = rows.some((row) => row.command.startsWith(`${root.command} `));
        if (!hasSubcommands) continue;
        expect(root.usage).toBe(root.command);
      }
    } finally {
      restore();
    }
  });

  test("argument forms reach the help text rather than the menu", () => {
    const list = slashCommandRows().find((row) => row.command === "/memory list");
    expect(list?.usage).toBe("/memory list [all|user|project] [--archived]");
    expect(suggestSlashCommands("/memory --archived")).toEqual([]);
  });

  test("slashCommandHelp returns short descriptions", () => {
    expect(slashCommandHelp("/model")).toBe("change model");
    expect(slashCommandHelp("/model work")).toBe("");
    expect(slashCommandHelp("/unknown")).toBe("");
  });
});
