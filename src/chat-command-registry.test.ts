import { describe, expect, test } from "bun:test";
import { appConfig } from "./app-config";
import { findCommandEntry, resolveCommandRegistry, runCommandEntry } from "./chat-command-registry";
import type { CommandContext, CommandEntry, ParsedCommand } from "./chat-commands-contract";
import { parseSlashCommand } from "./chat-commands-contract";
import { chatSlashCommands } from "./chat-slash";

function setWorkspacesEnabled(enabled: boolean): () => void {
  const cfg = appConfig as unknown as { features: { workspaces: boolean } };
  const prev = cfg.features.workspaces;
  cfg.features.workspaces = enabled;
  return () => {
    cfg.features.workspaces = prev;
  };
}

function createProbeEntry(seen: { parsed: ParsedCommand | null; handler: string }): CommandEntry {
  const record = (handler: string) => async (_ctx: CommandContext, parsed: ParsedCommand) => {
    seen.parsed = parsed;
    seen.handler = handler;
    return { stop: true, userText: handler };
  };
  return {
    spec: {
      name: "probe",
      source: "builtin",
      helpKey: "chat.slash.help.memory",
      subcommands: [{ name: "rm", usage: "/probe rm <id>", helpKey: "chat.slash.help.memory.rm" }],
    },
    run: record("root"),
    runSub: { rm: record("rm") },
  };
}

const ctx = {} as CommandContext;

describe("runCommandEntry", () => {
  test("routes a declared subcommand to its handler with the remaining args", async () => {
    const seen = { parsed: null as ParsedCommand | null, handler: "" };
    await runCommandEntry(createProbeEntry(seen), ctx, parseSlashCommand("/probe rm mem_abc"));
    expect(seen.handler).toBe("rm");
    expect(seen.parsed?.args).toEqual(["mem_abc"]);
  });

  test("routes a bare root to the root handler with no args", async () => {
    const seen = { parsed: null as ParsedCommand | null, handler: "" };
    await runCommandEntry(createProbeEntry(seen), ctx, parseSlashCommand("/probe"));
    expect(seen.handler).toBe("root");
    expect(seen.parsed?.args).toEqual([]);
  });

  test("folds an undeclared token into the root handler's args", async () => {
    const seen = { parsed: null as ParsedCommand | null, handler: "" };
    await runCommandEntry(createProbeEntry(seen), ctx, parseSlashCommand("/probe unknown extra"));
    expect(seen.handler).toBe("root");
    expect(seen.parsed?.args).toEqual(["unknown", "extra"]);
  });
});

describe("resolveCommandRegistry", () => {
  test("holds exactly one entry per name", () => {
    const names = resolveCommandRegistry().map((entry) => entry.spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("declares a handler for every declared subcommand", () => {
    for (const entry of resolveCommandRegistry()) {
      for (const sub of entry.spec.subcommands) {
        expect(entry.runSub?.[sub.name]).toBeFunction();
      }
    }
  });

  test("holds an entry for every enumerated slash command", () => {
    const restore = setWorkspacesEnabled(true);
    try {
      for (const command of chatSlashCommands()) {
        expect(findCommandEntry(command.slice(1))?.spec.name).toBe(command.slice(1));
      }
    } finally {
      restore();
    }
  });

  test("omits a flagged command while its flag is off", () => {
    const restore = setWorkspacesEnabled(false);
    try {
      expect(findCommandEntry("workspaces")).toBeNull();
    } finally {
      restore();
    }
  });

  test("includes a flagged command while its flag is on", () => {
    const restore = setWorkspacesEnabled(true);
    try {
      expect(findCommandEntry("workspaces")?.spec.name).toBe("workspaces");
    } finally {
      restore();
    }
  });
});
