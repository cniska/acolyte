import { afterEach, describe, expect, test } from "bun:test";
import { appConfig } from "./app-config";
import { dispatchSlashCommand, sessionsRows, statusRows, usageRows } from "./chat-commands";
import { isCommandOutput } from "./chat-contract";
import type { ConfigScope } from "./config-contract";
import type { MemoryScope } from "./memory-contract";
import type { SessionTokenUsageEntry } from "./session-contract";
import { loadSkills, resetSkillCache } from "./skills";
import { createCommandContext, createMessage, createSession, createStore, tempDir, writeSkill } from "./test-utils";

async function runCommand(text: string, overrides: Parameters<typeof createCommandContext>[1] = {}) {
  const { ctx, spies } = createCommandContext(text, overrides);
  const result = await dispatchSlashCommand(ctx);
  return { ...spies, stop: result.stop, userText: result.userText };
}

describe("chat-commands", () => {
  test("usageRows includes expected metric keys", () => {
    const usage: SessionTokenUsageEntry = {
      id: "row_1",
      usage: {
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
        inputBudgetTokens: 300,
        inputTruncated: false,
      },
      promptBreakdown: {
        budgetTokens: 300,
        usedTokens: 100,
        systemTokens: 40,
        toolTokens: 30,
        memoryTokens: 20,
        messageTokens: 10,
      },
    };
    const [row] = usageRows(usage);
    const content = row?.content;
    const allPairs = isCommandOutput(content) ? content.sections.flat() : [];
    const keys = allPairs.map(([k]) => k);
    expect(keys).toContain("Input");
    expect(keys).toContain("Output");
    expect(keys).toContain("System");
    expect(keys).toContain("Tools");
    expect(keys).toContain("Messages");
  });

  test("usageRows does not include budget warning", () => {
    const usage: SessionTokenUsageEntry = {
      id: "row_warn",
      usage: {
        inputTokens: 900,
        outputTokens: 40,
        totalTokens: 940,
        inputBudgetTokens: 1000,
        inputTruncated: true,
      },
    };
    const [row] = usageRows(usage);
    const content = row?.content;
    const allPairs = isCommandOutput(content) ? content.sections.flat() : [];
    expect(allPairs.every(([k]) => !k.toLowerCase().includes("warning"))).toBe(true);
    expect(allPairs.every(([, v]) => !v.includes("context trimmed"))).toBe(true);
  });

  test("usageRows uses prompt breakdown total for percentages", () => {
    const usage: SessionTokenUsageEntry = {
      id: "row_1",
      usage: { inputTokens: 50, outputTokens: 2, totalTokens: 52 },
      promptBreakdown: {
        budgetTokens: 1000,
        usedTokens: 100,
        systemTokens: 20,
        toolTokens: 30,
        memoryTokens: 10,
        messageTokens: 40,
      },
    };
    const [row] = usageRows(usage);
    const content = row?.content;
    const allPairs = isCommandOutput(content) ? content.sections.flat() : [];
    const find = (key: string) => allPairs.find(([k]) => k === key)?.[1] ?? "";
    expect(find("System")).toContain("20%");
    expect(find("Tools")).toContain("30%");
    expect(find("Memory")).toContain("10%");
    expect(find("Messages")).toContain("40%");
  });

  test("statusRows returns commandOutput with labeled fields", () => {
    const [row] = statusRows({
      providers: ["openai"],
      model: "gpt-5-mini",
    });
    const content = row?.content;
    expect(isCommandOutput(content) && content.header).toBe("Status");
    const pairs = isCommandOutput(content) ? (content.sections[0] ?? []) : [];
    expect(pairs).toContainEqual(["Providers", "openai"]);
    expect(pairs).toContainEqual(["Model", "gpt-5-mini"]);
  });

  test("statusRows returns empty array when payload has no visible fields", () => {
    expect(statusRows({})).toHaveLength(0);
  });

  test("sessionsRows returns commandOutput with header and list", () => {
    const store = createStore({
      activeSessionId: "sess_aaaa1111",
      sessions: [createSession({ id: "sess_aaaa1111", title: "First" })],
    });
    const [row] = sessionsRows(store, 10);
    const content = row?.content;
    expect(isCommandOutput(content) && content.header).toBe("Sessions 1");
    expect(isCommandOutput(content) && content.list?.some((line) => line.includes("● sess_aaaa1111"))).toBe(true);
    expect(isCommandOutput(content) && content.list?.some((line) => line.includes("First"))).toBe(true);
  });

  test("usageRows returns fallback row when no usage data", () => {
    const [row] = usageRows(null);
    expect(row?.content).toBe("No usage data yet. Send a prompt first.");
  });

  test("dispatchSlashCommand handles /usage", async () => {
    const tokenUsage: SessionTokenUsageEntry[] = [
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
          memoryTokens: 2,
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
          memoryTokens: 4,
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
    const store = createStore({
      activeSessionId: "sess_aaaa1111",
      sessions: [
        createSession({ id: "sess_aaaa1111", title: "First" }),
        createSession({ id: "sess_bbbb2222", title: "Second" }),
      ],
    });
    const { rows, stop } = await runCommand("/sessions", { store });
    expect(stop).toBe(true);
    const row = rows.find((r) => isCommandOutput(r.content) && r.content.header === "Sessions 2");
    expect(row).toBeDefined();
    expect(isCommandOutput(row?.content) && row?.content.list?.some((line) => line.includes("● sess_aaaa1111"))).toBe(
      true,
    );
    expect(isCommandOutput(row?.content) && row?.content.list?.some((line) => line.includes("sess_bbbb2222"))).toBe(
      true,
    );
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
    expect(rows.some((row) => row.kind === "system" && row.content === "No memory saved yet.")).toBe(true);
  });

  test("dispatchSlashCommand handles scoped /memory with empty store", async () => {
    let receivedScope = "";
    const memoryApi = {
      listMemories: async (options?: { scope?: MemoryScope }) => {
        receivedScope = options?.scope ?? "";
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
    expect(rows.some((row) => row.kind === "system" && row.content === "No user memory saved yet.")).toBe(true);
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
    const row = rows.find((r) => isCommandOutput(r.content) && r.content.header === "Memory 2");
    expect(row).toBeDefined();
    expect(isCommandOutput(row?.content) && row?.content.list).toContain("user:mem_1 prefer concise output");
    expect(isCommandOutput(row?.content) && row?.content.list).toContain("project:mem_2 use bun scripts");
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
    const row = rows.find((r) => isCommandOutput(r.content) && r.content.header === "Memory 2");
    expect(row).toBeDefined();
    expect(isCommandOutput(row?.content) && row?.content.list).toContain("user:mem_1 prefer concise output");
    expect(isCommandOutput(row?.content) && row?.content.list).toContain("project:mem_2 use bun scripts");
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
    expect(
      rows.some(
        (row) => typeof row.content === "string" && row.content.includes("Removed project memory mem_deadbeef."),
      ),
    ).toBe(true);
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
    expect(rows.some((row) => isCommandOutput(row.content) && row.content.header === "User memory 1")).toBe(true);
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
    expect(rows.some((row) => isCommandOutput(row.content) && row.content.header === "Project memory 1")).toBe(true);
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
      addMemory: async (content: string, options?: { scope?: MemoryScope }) => {
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
      (appConfig as { model: string }).model = previousModel;
    }
  });

  test("dispatchSlashCommand /new resets rows to new-session status", async () => {
    const session = createSession({ id: "sess_current" });
    const store = createStore({ sessions: [session], activeSessionId: session.id });
    const { ctx, spies } = createCommandContext("/new", { store, currentSession: session });

    const result = await dispatchSlashCommand(ctx);

    expect(result.stop).toBe(true);
    expect(spies.rows).toHaveLength(0);
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
          usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
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
    const { createDir, cleanupDirs } = tempDir();
    afterEach(() => {
      resetSkillCache();
      cleanupDirs();
    });

    test("/skillname with args continues to agent turn", async () => {
      const tmpDir = createDir("acolyte-cmd-skill-");
      writeSkill(tmpDir, "demo", "---\nname: demo\ndescription: Demo\n---", "# Demo");
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

    test("/skillname without args starts assistant turn directly", async () => {
      const tmpDir = createDir("acolyte-cmd-skill-");
      writeSkill(tmpDir, "demo", "---\nname: demo\ndescription: Demo\n---", "# Demo");
      await loadSkills(tmpDir);

      const assistantTurnTexts: string[] = [];
      const result = await runCommand("/demo", {
        activateSkill: async () => true,
        startAssistantTurn: async (text) => {
          assistantTurnTexts.push(text);
        },
      });
      expect(result.stop).toBe(true);
      expect(assistantTurnTexts).toEqual(["Run the demo skill."]);
    });

    test("unknown /xyz still shows unknown command", async () => {
      resetSkillCache();
      const { rows, stop } = await runCommand("/xyz");
      expect(stop).toBe(true);
      expect(rows.some((r) => typeof r.content === "string" && r.content.includes("Unknown command"))).toBe(true);
    });
  });
});
