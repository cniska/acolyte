import { describe, expect, test } from "bun:test";
import { appConfig, setModel } from "./app-config";
import { fullUsage, MEMORY_SPEC, subcommandUsage } from "./chat-command-specs";
import { dispatchSlashCommand } from "./chat-commands";
import { isCommandOutput } from "./chat-contract";
import { formatUsage } from "./cli-help";
import type { ConfigScope } from "./config-contract";
import type { MemoryArchiveEntry, MemoryEntry, MemoryScope, RemoveMemoryResult } from "./memory-contract";
import type { MemoryOptions } from "./memory-ops";
import { createCommandContext, createMessage, createSession, createSessionState } from "./test-utils";

function createMemoryApi(overrides?: {
  listMemories?: (options?: MemoryOptions) => Promise<MemoryEntry[]>;
  addMemory?: (
    content: string,
    options?: Omit<MemoryOptions, "scope"> & { scope?: MemoryScope },
  ) => Promise<MemoryEntry>;
  removeMemory?: (id: string, options?: MemoryOptions) => Promise<RemoveMemoryResult>;
  listArchivedMemories?: (options?: MemoryOptions) => Promise<MemoryArchiveEntry[]>;
}) {
  return {
    listMemories: overrides?.listMemories ?? (async () => []),
    addMemory:
      overrides?.addMemory ??
      (async () => ({
        id: "mem_unused",
        kind: "stored" as const,
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
        lastRecalledAt: null,
      })),
    removeMemory: overrides?.removeMemory ?? (async () => ({ kind: "not_found" as const, id: "" })),
    listArchivedMemories: overrides?.listArchivedMemories ?? (async () => []),
  };
}

async function runCommand(text: string, overrides: Parameters<typeof createCommandContext>[1] = {}) {
  const { ctx, spies } = createCommandContext(text, overrides);
  const result = await dispatchSlashCommand(ctx);
  return { ...spies, stop: result.stop, userText: result.userText };
}

describe("chat-commands", () => {
  test("dispatchSlashCommand handles /usage", async () => {
    const tokenUsage = [
      {
        id: "row_2",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        promptBreakdown: {
          budgetTokens: 100,
          usedTokens: 10,
          systemTokens: 4,
          toolTokens: 3,
          skillTokens: 0,
          memoryTokens: 0,
          messageTokens: 1,
        },
      },
      {
        id: "row_3",
        usage: {
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
        },
        promptBreakdown: {
          budgetTokens: 100,
          usedTokens: 20,
          systemTokens: 8,
          toolTokens: 6,
          skillTokens: 0,
          memoryTokens: 0,
          messageTokens: 2,
        },
      },
    ];
    const { rows, stop } = await runCommand("/usage", { tokenUsage });

    expect(stop).toBe(true);
    expect(rows.some((row) => isCommandOutput(row.content) && row.content.header === "Usage")).toBe(true);
  });

  test("dispatchSlashCommand handles /usage with empty usage", async () => {
    const { rows, stop } = await runCommand("/usage");

    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "No usage data yet. Send a prompt first.")).toBe(true);
  });

  test("dispatchSlashCommand handles /status", async () => {
    const { rows, stop } = await runCommand("/status");
    expect(stop).toBe(true);
    expect(rows.some((row) => isCommandOutput(row.content) && row.content.header === "Status")).toBe(true);
  });

  test("dispatchSlashCommand handles /sessions with compact system output", async () => {
    const sessionState = createSessionState({
      activeSessionId: "sess_aaaa1111",
      sessions: [
        createSession({ id: "sess_aaaa1111", title: "First" }),
        createSession({ id: "sess_bbbb2222", title: "Second" }),
      ],
    });
    const { rows, stop } = await runCommand("/sessions", { sessionState });
    expect(stop).toBe(true);
    const row = rows.find((r) => isCommandOutput(r.content) && r.content.header === "Sessions 2");
    expect(row).toBeDefined();
    expect(isCommandOutput(row?.content) && row?.content.list?.some((line) => line.includes("◆ sess_aaaa1111"))).toBe(
      true,
    );
    expect(isCommandOutput(row?.content) && row?.content.list?.some((line) => line.includes("sess_bbbb2222"))).toBe(
      true,
    );
  });

  test("dispatchSlashCommand handles /memory with empty store", async () => {
    const memoryApi = createMemoryApi();
    const { rows, stop } = await runCommand("/memory", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.kind === "system" && row.content === "No memory saved yet.")).toBe(true);
  });

  test("dispatchSlashCommand handles /memory list", async () => {
    const memoryApi = createMemoryApi();
    const { rows, stop } = await runCommand("/memory list", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.kind === "system" && row.content === "No memory saved yet.")).toBe(true);
  });

  test("dispatchSlashCommand answers an unknown /memory token with every accepted form", async () => {
    const memoryApi = createMemoryApi();
    const { rows, stop } = await runCommand("/memory bogus", { memoryApi });
    expect(stop).toBe(true);
    const content = rows.filter((row) => row.kind === "system").map((row) => row.content);
    expect(content).toContain("Unknown subcommand: bogus");
    // The list subcommand carries the grammar the default handler accepts, so it is pinned
    // literally here rather than derived from the spec the implementation also reads.
    expect(content).toContain("Usage: /memory [add|rm|list]");
    expect(content).toContain("Usage: /memory list [all|user|project] [--archived]");
    for (const usage of fullUsage(MEMORY_SPEC)) {
      expect(content).toContain(formatUsage(usage));
    }
  });

  test("dispatchSlashCommand reports the list form when /memory gets extra scopes", async () => {
    const memoryApi = createMemoryApi();
    const listUsage = formatUsage(subcommandUsage(MEMORY_SPEC, "list"));

    const bare = await runCommand("/memory user project", { memoryApi });
    const bareContent = bare.rows.filter((row) => row.kind === "system").map((row) => row.content);
    expect(bareContent).toContain(listUsage);

    const sub = await runCommand("/memory list user project", { memoryApi });
    const subContent = sub.rows.filter((row) => row.kind === "system").map((row) => row.content);
    expect(subContent).toContain(listUsage);
  });

  test("dispatchSlashCommand scopes /memory list", async () => {
    let receivedScope = "";
    const memoryApi = createMemoryApi({
      listMemories: async (options) => {
        receivedScope = options?.scope ?? "";
        return [];
      },
    });
    const { stop } = await runCommand("/memory list project", { memoryApi });
    expect(stop).toBe(true);
    expect(receivedScope).toBe("project");
  });

  test("dispatchSlashCommand handles scoped /memory with empty store", async () => {
    let receivedScope = "";
    const memoryApi = createMemoryApi({
      listMemories: async (options) => {
        receivedScope = options?.scope ?? "";
        return [];
      },
    });
    const { rows, stop } = await runCommand("/memory user", { memoryApi });
    expect(stop).toBe(true);
    expect(receivedScope).toBe("user");
    expect(rows.some((row) => row.kind === "system" && row.content === "No user memory saved yet.")).toBe(true);
  });

  test("dispatchSlashCommand handles /memory with entries", async () => {
    const memoryApi = createMemoryApi({
      listMemories: async () => [
        {
          id: "mem_1",
          kind: "stored" as const,
          scope: "user" as const,
          content: "prefer concise output",
          createdAt: "2026-02-21T00:00:00.000Z",
          lastRecalledAt: null,
        },
        {
          id: "mem_2",
          kind: "stored" as const,
          scope: "project" as const,
          content: "use bun scripts",
          createdAt: "2026-02-21T00:00:01.000Z",
          lastRecalledAt: null,
        },
      ],
    });
    const { rows, stop } = await runCommand("/memory", { memoryApi });
    expect(stop).toBe(true);
    const row = rows.find((r) => isCommandOutput(r.content) && r.content.header === "Memory 2");
    expect(row).toBeDefined();
    expect(isCommandOutput(row?.content) && row?.content.list).toContain("user:mem_1 prefer concise output");
    expect(isCommandOutput(row?.content) && row?.content.list).toContain("project:mem_2 use bun scripts");
  });

  test("dispatchSlashCommand handles explicit /memory all scope", async () => {
    const memoryApi = createMemoryApi({
      listMemories: async () => [
        {
          id: "mem_1",
          kind: "stored" as const,
          scope: "user" as const,
          content: "prefer concise output",
          createdAt: "2026-02-21T00:00:00.000Z",
          lastRecalledAt: null,
        },
        {
          id: "mem_2",
          kind: "stored" as const,
          scope: "project" as const,
          content: "use bun scripts",
          createdAt: "2026-02-21T00:00:01.000Z",
          lastRecalledAt: null,
        },
      ],
    });
    const { rows, stop } = await runCommand("/memory all", { memoryApi });
    expect(stop).toBe(true);
    const row = rows.find((r) => isCommandOutput(r.content) && r.content.header === "Memory 2");
    expect(row).toBeDefined();
    expect(isCommandOutput(row?.content) && row?.content.list).toContain("user:mem_1 prefer concise output");
    expect(isCommandOutput(row?.content) && row?.content.list).toContain("project:mem_2 use bun scripts");
  });

  test("dispatchSlashCommand handles /memory rm success", async () => {
    const memoryApi = createMemoryApi({
      removeMemory: async () => ({
        kind: "removed" as const,
        entry: {
          id: "mem_deadbeef",
          kind: "stored" as const,
          scope: "project" as const,
          content: "x",
          createdAt: "2026-02-21T00:00:00.000Z",
          lastRecalledAt: null,
        },
      }),
    });
    const { rows, stop } = await runCommand("/memory rm mem_dead", { memoryApi });
    expect(stop).toBe(true);
    expect(
      rows.some(
        (row) => typeof row.content === "string" && row.content.includes("Removed project memory mem_deadbeef."),
      ),
    ).toBe(true);
  });

  test("dispatchSlashCommand handles /memory rm not_found", async () => {
    const memoryApi = createMemoryApi({
      removeMemory: async () => ({ kind: "not_found" as const, id: "mem_zzz" }),
    });
    const { rows, stop } = await runCommand("/memory rm mem_zzz", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "No memory found for id: mem_zzz")).toBe(true);
  });

  test("dispatchSlashCommand renders scoped /memory header", async () => {
    const memoryApi = createMemoryApi({
      listMemories: async () => [
        {
          id: "mem_1",
          kind: "stored" as const,
          scope: "user" as const,
          content: "prefer concise output",
          createdAt: "2026-02-21T00:00:00.000Z",
          lastRecalledAt: null,
        },
      ],
    });
    const { rows, stop } = await runCommand("/memory user", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => isCommandOutput(row.content) && row.content.header === "User memory 1")).toBe(true);
  });

  test("dispatchSlashCommand renders project-scoped /memory header", async () => {
    const memoryApi = createMemoryApi({
      listMemories: async () => [
        {
          id: "mem_1",
          kind: "stored" as const,
          scope: "project" as const,
          content: "use bun scripts",
          createdAt: "2026-02-21T00:00:00.000Z",
          lastRecalledAt: null,
        },
      ],
    });
    const { rows, stop } = await runCommand("/memory project", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => isCommandOutput(row.content) && row.content.header === "Project memory 1")).toBe(true);
  });

  test("dispatchSlashCommand handles bare /memory --archived", async () => {
    let receivedScope: string | undefined = "sentinel";
    let listedActive = false;
    const memoryApi = createMemoryApi({
      listMemories: async () => {
        listedActive = true;
        return [];
      },
      listArchivedMemories: async (options) => {
        receivedScope = options?.scope;
        return [
          {
            id: "mem_gone",
            kind: "observation" as const,
            scope: "project" as const,
            content: "a listing nobody needed",
            createdAt: "2026-02-21T00:00:00.000Z",
            lastRecalledAt: null,
            retiredAt: "2026-02-22T00:00:00.000Z",
            disposition: { kind: "noise" as const },
          },
        ];
      },
    });
    const { rows, stop } = await runCommand("/memory --archived", { memoryApi });
    expect(stop).toBe(true);
    expect(listedActive).toBe(false);
    expect(receivedScope).toBeUndefined();
    expect(
      rows.some(
        (row) =>
          isCommandOutput(row.content) &&
          row.content.header === "Retired memory 1" &&
          row.content.list?.some((line) => line.includes("[noise]")),
      ),
    ).toBe(true);
  });

  test("dispatchSlashCommand scopes /memory project --archived", async () => {
    let receivedScope = "";
    const memoryApi = createMemoryApi({
      listArchivedMemories: async (options) => {
        receivedScope = options?.scope ?? "";
        return [];
      },
    });
    const { stop } = await runCommand("/memory project --archived", { memoryApi });
    expect(stop).toBe(true);
    expect(receivedScope).toBe("project");
  });

  test("dispatchSlashCommand shows superseding lineage in the archive", async () => {
    const memoryApi = createMemoryApi({
      listArchivedMemories: async () => [
        {
          id: "mem_old",
          kind: "observation" as const,
          scope: "project" as const,
          content: "half a fact",
          createdAt: "2026-02-21T00:00:00.000Z",
          lastRecalledAt: null,
          retiredAt: "2026-02-22T00:00:00.000Z",
          disposition: { kind: "superseded" as const, by: ["mem_new"] },
        },
      ],
    });
    const { rows } = await runCommand("/memory --archived", { memoryApi });
    expect(
      rows.some(
        (row) =>
          isCommandOutput(row.content) && row.content.list?.some((line) => line.includes("superseded by mem_new")),
      ),
    ).toBe(true);
  });

  test("dispatchSlashCommand reports an empty archive", async () => {
    const memoryApi = createMemoryApi();
    const { rows, stop } = await runCommand("/memory --archived", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "No retired memory.")).toBe(true);
  });

  test("dispatchSlashCommand renders an archive listing failure", async () => {
    const memoryApi = createMemoryApi({
      listArchivedMemories: async () => {
        throw new Error("archive unavailable");
      },
    });
    const { rows, stop } = await runCommand("/memory --archived", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "archive unavailable")).toBe(true);
  });

  test("dispatchSlashCommand renders an active listing failure", async () => {
    const memoryApi = createMemoryApi({
      listMemories: async () => {
        throw new Error("memory unavailable");
      },
    });
    const { rows, stop } = await runCommand("/memory", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "memory unavailable")).toBe(true);
  });

  test("dispatchSlashCommand handles /memory add and saves selected scope", async () => {
    let savedContent = "";
    let savedScope = "";
    const memoryApi = createMemoryApi({
      addMemory: async (content, options) => {
        const scope = options?.scope ?? "user";
        savedContent = content;
        savedScope = scope;
        return {
          id: "mem_3",
          kind: "stored" as const,
          scope,
          content,
          createdAt: "2026-02-21T00:00:02.000Z",
          lastRecalledAt: null,
        };
      },
    });
    const { rows, stop } = await runCommand("/memory add --project use bun verify", { memoryApi });
    expect(stop).toBe(true);
    expect(savedContent).toBe("use bun verify");
    expect(savedScope).toBe("project");
    expect(rows.some((row) => row.kind === "system" && row.content === "Saved project memory: use bun verify")).toBe(
      true,
    );
  });

  test("dispatchSlashCommand updates model via /model <id>", async () => {
    const previousModel = appConfig.model;
    const writes: Array<{ key: string; value: string; scope: ConfigScope }> = [];
    try {
      const { rows, stop } = await runCommand("/model gpt-5.2", {
        persistModelConfig: async (key, value, scope) => {
          writes.push({ key, value, scope });
        },
      });
      expect(stop).toBe(true);
      expect(rows.some((row) => row.content === "Changed model to gpt-5.2.")).toBe(true);
      expect(writes).toEqual([{ key: "model", value: "gpt-5.2", scope: "project" }]);
      expect(appConfig.model).toBe("gpt-5.2");
    } finally {
      setModel(previousModel);
    }
  });

  test("dispatchSlashCommand /model <id> persists session", async () => {
    const previousModel = appConfig.model;
    try {
      const { persistCalls, stop } = await runCommand("/model gpt-5.2", {
        persistModelConfig: async () => {},
      });
      expect(stop).toBe(true);
      expect(persistCalls).toBe(1);
    } finally {
      setModel(previousModel);
    }
  });

  test("dispatchSlashCommand /new resets rows to new-session status", async () => {
    const session = createSession({ id: "sess_current" });
    const sessionState = createSessionState({ sessions: [session], activeSessionId: session.id });
    const { ctx, spies } = createCommandContext("/new", { sessionState, currentSession: session });

    const result = await dispatchSlashCommand(ctx);

    expect(result.stop).toBe(true);
    expect(spies.rows).toHaveLength(0);
    expect(spies.currentSessionIds).toHaveLength(1);
    expect(spies.tokenUsageSets).toEqual([[]]);
    expect(sessionState.sessions).toHaveLength(2);
    expect(sessionState.activeSessionId).toBe(spies.currentSessionIds[0]);
  });

  test("dispatchSlashCommand /resume with prefix restores matching session", async () => {
    const target = createSession({
      id: "sess_resume_target",
      title: "Resume Target",
      messages: [createMessage("assistant", "hi")],
      tokenUsage: [
        {
          id: "row_1",
          usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
          modelCalls: 2,
        },
      ],
    });
    const sessionState = createSessionState({
      sessions: [target, createSession({ id: "sess_other", title: "Other" })],
      activeSessionId: "sess_other",
    });
    const text = `/resume ${target.id.slice(0, 12)}`;
    const { ctx, spies } = createCommandContext(text, { sessionState });

    const result = await dispatchSlashCommand(ctx);

    expect(result.stop).toBe(true);
    expect(sessionState.activeSessionId).toBe(target.id);
    expect(spies.currentSessionIds).toEqual([target.id]);
    expect(spies.tokenUsageSets).toEqual([target.tokenUsage]);
  });

  test("dispatchSlashCommand /resume is no-op when target is already active", async () => {
    const active = createSession({
      id: "sess_already_active",
      title: "Already Active",
      messages: [createMessage("assistant", "hi")],
    });
    const sessionState = createSessionState({
      sessions: [active],
      activeSessionId: active.id,
    });
    const text = `/resume ${active.id.slice(0, 12)}`;
    const { ctx, spies } = createCommandContext(text, { sessionState });

    const result = await dispatchSlashCommand(ctx);

    expect(result.stop).toBe(true);
    expect(spies.currentSessionIds).toEqual([]);
    expect(spies.tokenUsageSets).toEqual([]);
  });

  test("dispatchSlashCommand /resume opens picker flow", async () => {
    const { rows, stop } = await runCommand("/resume");
    expect(stop).toBe(true);
    expect(rows.every((row) => row.kind !== "user")).toBe(true);
  });

  test("dispatchSlashCommand /resume with missing prefix reports not found", async () => {
    const { rows, stop } = await runCommand("/resume missing");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "No session found for prefix: missing")).toBe(true);
  });

  test("dispatchSlashCommand supports /new then /resume round-trip", async () => {
    const original = createSession({
      id: "sess_original",
      title: "Original Session",
      messages: [createMessage("assistant", "orig")],
    });
    const sessionState = createSessionState({
      sessions: [original],
      activeSessionId: original.id,
    });

    const { ctx: newCtx } = createCommandContext("/new", { sessionState, currentSession: original });
    const newResult = await dispatchSlashCommand(newCtx);
    expect(newResult.stop).toBe(true);
    const createdId = sessionState.activeSessionId ?? "";
    expect(createdId.startsWith("sess_")).toBe(true);
    expect(createdId).not.toBe(original.id);

    const resumeText = `/resume ${original.id.slice(0, 12)}`;
    const { ctx: resumeCtx, spies } = createCommandContext(resumeText, { sessionState });
    const resumeResult = await dispatchSlashCommand(resumeCtx);
    expect(resumeResult.stop).toBe(true);
    expect(sessionState.activeSessionId).toBe(original.id);
    expect(spies.currentSessionIds).toContain(original.id);
  });

  describe("/workspaces", () => {
    function setWorkspacesEnabled(enabled: boolean): () => void {
      const cfg = appConfig as unknown as { features: { workspaces: boolean } };
      const prev = cfg.features.workspaces;
      cfg.features.workspaces = enabled;
      return () => {
        cfg.features.workspaces = prev;
      };
    }

    test("is unknown while features.workspaces is off", async () => {
      const restore = setWorkspacesEnabled(false);
      try {
        const { rows, stop } = await runCommand("/workspaces");
        expect(stop).toBe(true);
        expect(rows.some((row) => row.content === "Unknown command: /workspaces")).toBe(true);
        expect(rows.some((row) => typeof row.content === "string" && row.content.includes("config set"))).toBe(false);
      } finally {
        restore();
      }
    });

    test("subcommands are unknown while features.workspaces is off", async () => {
      const restore = setWorkspacesEnabled(false);
      try {
        const { rows, stop } = await runCommand("/workspaces list");
        expect(stop).toBe(true);
        expect(rows.some((row) => row.content === "Unknown command: /workspaces list")).toBe(true);
      } finally {
        restore();
      }
    });

    test("list renders existing workspace sessions", async () => {
      const restore = setWorkspacesEnabled(true);
      try {
        const ws = createSession({
          id: "sess_ws1",
          title: "Fix auth",
          workspaceName: "fix-auth",
          workspace: "/tmp/ws/fix-auth",
          workspaceBranch: "acolyte-ws/fix-auth",
        });
        const sessionState = createSessionState({ sessions: [ws], activeSessionId: ws.id });
        const { rows, stop } = await runCommand("/workspaces", { sessionState });
        expect(stop).toBe(true);
        const headerRow = rows.find(
          (row) => isCommandOutput(row.content) && row.content.header.startsWith("Workspaces "),
        );
        expect(Boolean(headerRow)).toBe(true);
      } finally {
        restore();
      }
    });
  });
});
