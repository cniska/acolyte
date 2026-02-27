import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appConfig, setPermissionMode } from "./app-config";
import { dispatchSlashCommand, formatTokenUsageOutput, type TokenUsageEntry } from "./chat-commands";
import { loadSkills, resetSkillCache } from "./skills";
import { createCommandContext, createMessage, createSession, createStore, tempDirFactory } from "./test-factory";

async function runCommand(text: string, overrides: Parameters<typeof createCommandContext>[1] = {}) {
  const { ctx, spies } = createCommandContext(text, overrides);
  const result = await dispatchSlashCommand(ctx);
  return { ...spies, stop: result.stop };
}

describe("chat-commands", () => {
  test("formatTokenUsageOutput renders aligned rows", () => {
    const usage: TokenUsageEntry = {
      id: "row_1",
      usage: {
        promptTokens: 100,
        completionTokens: 40,
        totalTokens: 140,
        promptBudgetTokens: 300,
        promptTruncated: false,
      },
      modelCalls: 3,
    };
    const output = formatTokenUsageOutput(usage, [usage]);
    expect(output).toContain("last_turn:");
    expect(output).toContain("session:");
    expect(output).toContain("budget:");
    expect(output).toContain("model_calls:");
    expect(output).toContain("last=3 session=3");
  });

  test("formatTokenUsageOutput includes latest warning when present", () => {
    const usage: TokenUsageEntry = {
      id: "row_warn",
      usage: {
        promptTokens: 900,
        completionTokens: 40,
        totalTokens: 940,
        promptBudgetTokens: 1000,
        promptTruncated: true,
      },
      warning: "context trimmed (8/42 history messages)",
    };
    const output = formatTokenUsageOutput(usage, [usage]);
    expect(output).toContain("warning:");
    expect(output).toContain("context trimmed (8/42 history messages)");
  });

  test("formatTokenUsageOutput shows latest session warning even when last turn has none", () => {
    const warned: TokenUsageEntry = {
      id: "row_warned",
      usage: {
        promptTokens: 950,
        completionTokens: 30,
        totalTokens: 980,
      },
      warning: "context near budget (950/1000 tokens)",
    };
    const clean: TokenUsageEntry = {
      id: "row_clean",
      usage: {
        promptTokens: 200,
        completionTokens: 20,
        totalTokens: 220,
      },
    };
    const output = formatTokenUsageOutput(clean, [warned, clean]);
    expect(output).toContain("warning:");
    expect(output).toContain("context near budget (950/1000 tokens)");
  });

  test("dispatchSlashCommand handles /tokens", async () => {
    const tokenUsage: TokenUsageEntry[] = [
      {
        id: "row_2",
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        modelCalls: 2,
      },
      {
        id: "row_3",
        usage: {
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
        },
        modelCalls: 5,
      },
    ];
    const { rows, stop } = await runCommand("/tokens", { tokenUsage });

    expect(stop).toBe(true);
    expect(rows.some((row) => row.content.includes("last_turn:"))).toBe(true);
    expect(rows.some((row) => row.role === "system" && row.content.includes("last_turn:"))).toBe(true);
    expect(rows.some((row) => row.role === "system" && row.style === "tokenOutput")).toBe(true);
    expect(rows.some((row) => row.content.includes("model_calls:") && row.content.includes("last=5 session=7"))).toBe(
      true,
    );
  });

  test("dispatchSlashCommand handles /tokens with empty usage", async () => {
    const { rows, stop } = await runCommand("/tokens");

    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "No token data yet. Send a prompt first.")).toBe(true);
  });

  test("dispatchSlashCommand auto-corrects typos to nearest command", async () => {
    const skill = await runCommand("/skill");
    expect(skill.stop).toBe(true);
    expect(skill.rows.every((row) => !row.content.includes("Unknown command"))).toBe(true);

    const status = await runCommand("/stauts");
    expect(status.stop).toBe(true);
    expect(status.rows.some((row) => row.style === "statusOutput")).toBe(true);
  });

  test("dispatchSlashCommand handles /status", async () => {
    const { rows, stop } = await runCommand("/status");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.role === "system" && row.style === "statusOutput")).toBe(true);
  });

  test("dispatchSlashCommand handles /sessions with compact system output", async () => {
    const store = createStore({
      activeSessionId: "sess_aaaa1111",
      sessions: [
        createSession({ id: "sess_aaaa1111", title: "First" }),
        createSession({ id: "sess_bbbb2222", title: "Second" }),
      ],
    });
    const { rows, stop } = await runCommand("/sessions", { store });
    expect(stop).toBe(true);
    const system = rows.find((row) => row.role === "system" && row.content.includes("Sessions 2"));
    expect(system).toBeDefined();
    expect(system?.style).toBe("sessionsList");
    expect(system?.content).toContain("● sess_aaaa1111  First");
    expect(system?.content).toContain("  sess_bbbb2222  Second");
  });

  test("dispatchSlashCommand handles /memory with empty store", async () => {
    const memoryApi = {
      listMemories: async () => [],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
    };
    const { rows, stop } = await runCommand("/memory", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.role === "system" && row.content === "No memory saved yet.")).toBe(true);
  });

  test("dispatchSlashCommand handles scoped /memory with empty store", async () => {
    let receivedScope = "";
    const memoryApi = {
      listMemories: async (options?: { scope?: "all" | "user" | "project" }) => {
        receivedScope = options?.scope ?? "all";
        return [];
      },
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
    };
    const { rows, stop } = await runCommand("/memory user", { memoryApi });
    expect(stop).toBe(true);
    expect(receivedScope).toBe("user");
    expect(rows.some((row) => row.role === "system" && row.content === "No user memory saved yet.")).toBe(true);
  });

  test("dispatchSlashCommand handles /memory with entries", async () => {
    const memoryApi = {
      listMemories: async () => [
        {
          id: "mem_1",
          scope: "user" as const,
          content: "prefer concise output",
          createdAt: "2026-02-21T00:00:00.000Z",
        },
        {
          id: "mem_2",
          scope: "project" as const,
          content: "use bun scripts",
          createdAt: "2026-02-21T00:00:01.000Z",
        },
      ],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
    };
    const { rows, stop } = await runCommand("/memory", { memoryApi });
    expect(stop).toBe(true);
    const system = rows.find((row) => row.role === "system" && row.content.startsWith("Memory 2"));
    expect(system).toBeDefined();
    expect(system?.content).toContain("user:mem_1 prefer concise output");
    expect(system?.content).toContain("project:mem_2 use bun scripts");
  });

  test("dispatchSlashCommand handles explicit /memory all scope", async () => {
    const memoryApi = {
      listMemories: async () => [
        {
          id: "mem_1",
          scope: "user" as const,
          content: "prefer concise output",
          createdAt: "2026-02-21T00:00:00.000Z",
        },
        {
          id: "mem_2",
          scope: "project" as const,
          content: "use bun scripts",
          createdAt: "2026-02-21T00:00:01.000Z",
        },
      ],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
    };
    const { rows, stop } = await runCommand("/memory all", { memoryApi });
    expect(stop).toBe(true);
    const system = rows.find((row) => row.role === "system" && row.content.startsWith("Memory 2"));
    expect(system).toBeDefined();
    expect(system?.content).toContain("user:mem_1 prefer concise output");
    expect(system?.content).toContain("project:mem_2 use bun scripts");
  });

  test("dispatchSlashCommand handles /memory rm success", async () => {
    const memoryApi = {
      listMemories: async () => [],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
      removeMemoryByPrefix: async () => ({
        kind: "removed" as const,
        entry: {
          id: "mem_deadbeef",
          scope: "project" as const,
          content: "x",
          createdAt: "2026-02-21T00:00:00.000Z",
        },
      }),
    };
    const { rows, stop } = await runCommand("/memory rm mem_dead", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content.includes("Removed project memory mem_deadbeef."))).toBe(true);
  });

  test("dispatchSlashCommand handles /memory rm not_found", async () => {
    const memoryApi = {
      listMemories: async () => [],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
      removeMemoryByPrefix: async () => ({ kind: "not_found" as const, prefix: "mem_zzz" }),
    };
    const { rows, stop } = await runCommand("/memory rm mem_zzz", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "No memory found for id prefix: mem_zzz")).toBe(true);
  });

  test("dispatchSlashCommand handles /memory rm ambiguous prefix", async () => {
    const memoryApi = {
      listMemories: async () => [],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
      removeMemoryByPrefix: async () => ({
        kind: "ambiguous" as const,
        prefix: "mem_a",
        matches: [
          { id: "mem_abcd1111", scope: "user" as const, content: "one", createdAt: "2026-02-21T00:00:00.000Z" },
          { id: "mem_abcd2222", scope: "project" as const, content: "two", createdAt: "2026-02-21T00:00:00.000Z" },
        ],
      }),
    };
    const { rows, stop } = await runCommand("/memory rm mem_a", { memoryApi });
    expect(stop).toBe(true);
    expect(
      rows.some((row) => row.content === "Ambiguous memory id prefix: mem_a. Matches: mem_abcd1111, mem_abcd2222"),
    ).toBe(true);
  });

  test("dispatchSlashCommand renders scoped /memory header", async () => {
    const memoryApi = {
      listMemories: async () => [
        {
          id: "mem_1",
          scope: "user" as const,
          content: "prefer concise output",
          createdAt: "2026-02-21T00:00:00.000Z",
        },
      ],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
    };
    const { rows, stop } = await runCommand("/memory user", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.role === "system" && row.content.startsWith("User memory 1"))).toBe(true);
  });

  test("dispatchSlashCommand renders project-scoped /memory header", async () => {
    const memoryApi = {
      listMemories: async () => [
        {
          id: "mem_1",
          scope: "project" as const,
          content: "use bun scripts",
          createdAt: "2026-02-21T00:00:00.000Z",
        },
      ],
      addMemory: async () => ({
        id: "mem_unused",
        scope: "user" as const,
        content: "unused",
        createdAt: "2026-02-21T00:00:00.000Z",
      }),
    };
    const { rows, stop } = await runCommand("/memory project", { memoryApi });
    expect(stop).toBe(true);
    expect(rows.some((row) => row.role === "system" && row.content.startsWith("Project memory 1"))).toBe(true);
  });

  test("dispatchSlashCommand validates /memory scope usage", async () => {
    const { rows, stop } = await runCommand("/memory foo");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "Usage: /memory [all|user|project]")).toBe(true);
  });

  test("dispatchSlashCommand validates /memory extra args", async () => {
    const { rows, stop } = await runCommand("/memory all extra");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "Usage: /memory [all|user|project]")).toBe(true);
  });

  test("dispatchSlashCommand handles /remember and saves selected scope", async () => {
    let savedContent = "";
    let savedScope = "";
    const memoryApi = {
      listMemories: async () => [],
      addMemory: async (content: string, options?: { scope?: "user" | "project" }) => {
        const scope = options?.scope ?? "user";
        savedContent = content;
        savedScope = scope;
        return {
          id: "mem_3",
          scope,
          content,
          createdAt: "2026-02-21T00:00:02.000Z",
        };
      },
    };
    const { rows, stop } = await runCommand("/remember --project use bun verify", { memoryApi });
    expect(stop).toBe(true);
    expect(savedContent).toBe("use bun verify");
    expect(savedScope).toBe("project");
    expect(rows.some((row) => row.role === "system" && row.content === "Saved project memory: use bun verify")).toBe(
      true,
    );
  });

  test("dispatchSlashCommand shows permission mode", async () => {
    const prev = appConfig.agent.permissions.mode;
    try {
      const { rows, stop, openedPermissions } = await runCommand("/permissions");
      expect(stop).toBe(true);
      expect(openedPermissions).toBe(true);
      expect(rows.some((row) => row.role === "user" && row.content === "/permissions")).toBe(true);
    } finally {
      setPermissionMode(prev);
    }
  });

  test("dispatchSlashCommand applies /permissions read|write", async () => {
    const prev = appConfig.agent.permissions.mode;
    try {
      const writes: Array<{ mode: "read" | "write"; scope: "user" | "project" }> = [];
      const setConfigPermissionMode = async (mode: "read" | "write", scope: "user" | "project") => {
        writes.push({ mode, scope });
      };

      const readResult = await runCommand("/permissions read", { setConfigPermissionMode });
      expect(readResult.stop).toBe(true);
      expect(appConfig.agent.permissions.mode).toBe("read");
      expect(
        readResult.rows.some(
          (row) => row.role === "system" && row.content === "Changed permissions to read (project).",
        ),
      ).toBe(true);
      expect(writes).toContainEqual({ mode: "read", scope: "project" });

      const writeResult = await runCommand("/permissions write --user", { setConfigPermissionMode });
      expect(writeResult.stop).toBe(true);
      expect(appConfig.agent.permissions.mode).toBe("write");
      expect(
        writeResult.rows.some((row) => row.role === "system" && row.content === "Changed permissions to write (user)."),
      ).toBe(true);
      expect(writes).toContainEqual({ mode: "write", scope: "user" });
    } finally {
      setPermissionMode(prev);
    }
  });

  test("dispatchSlashCommand validates /permissions usage", async () => {
    const prev = appConfig.agent.permissions.mode;
    try {
      const { rows, stop } = await runCommand("/permissions maybe");
      expect(stop).toBe(true);
      expect(rows.some((row) => row.content === "Usage: /permissions [read|write] [--project|--user]")).toBe(true);
      const invalidScope = await runCommand("/permissions read --wat");
      expect(invalidScope.stop).toBe(true);
      expect(
        invalidScope.rows.some((row) => row.content === "Usage: /permissions [read|write] [--project|--user]"),
      ).toBe(true);
      expect(appConfig.agent.permissions.mode).toBe(prev);
    } finally {
      setPermissionMode(prev);
    }
  });

  test("dispatchSlashCommand /new resets rows to new-session status", async () => {
    const session = createSession({ id: "sess_current" });
    const store = createStore({ sessions: [session], activeSessionId: session.id });
    const { ctx, spies } = createCommandContext("/new", { store, currentSession: session });

    const result = await dispatchSlashCommand(ctx);

    expect(result.stop).toBe(true);
    expect(spies.rows).toHaveLength(2);
    expect(spies.rows[0]).toMatchObject({ role: "user", content: "/new" });
    expect(spies.rows[1]?.role).toBe("system");
    expect(spies.rows[1]?.content.startsWith("Started new session: sess_")).toBe(true);
    expect(spies.rows[1]?.style).toBe("sessionStatus");
    expect(spies.currentSessionIds).toHaveLength(1);
    expect(spies.tokenUsageSets).toEqual([[]]);
    expect(store.sessions).toHaveLength(2);
    expect(store.activeSessionId).toBe(spies.currentSessionIds[0]);
  });

  test("dispatchSlashCommand /resume with prefix restores matching session", async () => {
    const target = createSession({
      id: "sess_resume_target",
      title: "Resume Target",
      messages: [createMessage("assistant", "hi")],
      tokenUsage: [
        {
          id: "row_1",
          usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
          modelCalls: 2,
        },
      ],
    });
    const store = createStore({
      sessions: [target, createSession({ id: "sess_other", title: "Other" })],
      activeSessionId: "sess_other",
    });
    const text = `/resume ${target.id.slice(0, 12)}`;
    const { ctx, spies } = createCommandContext(text, { store });

    const result = await dispatchSlashCommand(ctx);

    expect(result.stop).toBe(true);
    expect(store.activeSessionId).toBe(target.id);
    expect(spies.currentSessionIds).toEqual([target.id]);
    expect(spies.tokenUsageSets).toEqual([target.tokenUsage]);
    expect(spies.rows.some((row) => row.style === "sessionStatus" && row.content.startsWith("Resumed session:"))).toBe(
      true,
    );
  });

  test("dispatchSlashCommand /resume opens picker flow", async () => {
    const { rows, stop } = await runCommand("/resume");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.role === "user" && row.content === "/resume")).toBe(true);
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
    const store = createStore({
      sessions: [original],
      activeSessionId: original.id,
    });

    const { ctx: newCtx } = createCommandContext("/new", { store, currentSession: original });
    const newResult = await dispatchSlashCommand(newCtx);
    expect(newResult.stop).toBe(true);
    const createdId = store.activeSessionId ?? "";
    expect(createdId.startsWith("sess_")).toBe(true);
    expect(createdId).not.toBe(original.id);

    const resumeText = `/resume ${original.id.slice(0, 12)}`;
    const { ctx: resumeCtx, spies } = createCommandContext(resumeText, { store });
    const resumeResult = await dispatchSlashCommand(resumeCtx);
    expect(resumeResult.stop).toBe(true);
    expect(store.activeSessionId).toBe(original.id);
    expect(spies.currentSessionIds).toContain(original.id);
  });

  describe("inline skill invocation", () => {
    const { createTempDir, cleanup } = tempDirFactory();
    afterEach(() => {
      resetSkillCache();
      cleanup();
    });

    test("/skillname with args continues to agent turn", async () => {
      const tmpDir = createTempDir("acolyte-cmd-skill-");
      const skillDir = join(tmpDir, "skills", "demo");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\n# Demo", "utf8");
      await loadSkills(tmpDir);

      const activated: string[] = [];
      const result = await runCommand("/demo run tests", {
        activateSkill: async (name, args) => {
          activated.push(name, args);
          return true;
        },
      });
      expect(result.stop).toBe(false);
      expect(activated).toEqual(["demo", "run tests"]);
    });

    test("/skillname without args stops and shows activation", async () => {
      const tmpDir = createTempDir("acolyte-cmd-skill-");
      const skillDir = join(tmpDir, "skills", "demo");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\n# Demo", "utf8");
      await loadSkills(tmpDir);

      const result = await runCommand("/demo", {
        activateSkill: async () => true,
      });
      expect(result.stop).toBe(true);
      expect(result.rows.some((r) => r.content.includes("Activated skill: demo"))).toBe(true);
    });

    test("unknown /xyz still shows unknown command", async () => {
      resetSkillCache();
      const { rows, stop } = await runCommand("/xyz");
      expect(stop).toBe(true);
      expect(rows.some((r) => r.content.includes("Unknown command"))).toBe(true);
    });
  });
});
