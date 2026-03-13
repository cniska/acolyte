import { afterEach, describe, expect, test } from "bun:test";
import { appConfig } from "./app-config";
import {
  dispatchSlashCommand,
  formatTokenUsageOutput,
  presentSessionsOutput,
  presentStatusOutput,
  presentTokensOutput,
} from "./chat-commands";
import type { ConfigScope } from "./config-contract";
import type { SessionTokenUsageEntry } from "./session-contract";
import { loadSkills, resetSkillCache } from "./skills";
import {
  createCommandContext,
  createMessage,
  createSession,
  createStore,
  dedent,
  tempDir,
  writeSkill,
} from "./test-utils";

async function runCommand(text: string, overrides: Parameters<typeof createCommandContext>[1] = {}) {
  const { ctx, spies } = createCommandContext(text, overrides);
  const result = await dispatchSlashCommand(ctx);
  return { ...spies, stop: result.stop, userText: result.userText };
}

describe("chat-commands", () => {
  test("formatTokenUsageOutput renders aligned rows", () => {
    const usage: SessionTokenUsageEntry = {
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
    expect(output).toContain("last turn:");
    expect(output).toContain("session:");
    expect(output).toContain("budget:");
    expect(output).toContain("model calls:");
    expect(output).toContain("last=3 session=3");
  });

  test("formatTokenUsageOutput includes latest warning when present", () => {
    const usage: SessionTokenUsageEntry = {
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

  test("presentStatusOutput renders command presentation block", () => {
    const rendered = presentStatusOutput({
      providers: ["openai"],
      model: "gpt-5-mini",
      permissions: "write",
    });
    expect(rendered).toBe(
      dedent(`
      providers:          openai
      model:              gpt-5-mini
      permissions:        write
    `),
    );
  });

  test("presentStatusOutput shows fallback when payload has no visible fields", () => {
    const rendered = presentStatusOutput({});
    expect(rendered).toBe("Status response was empty.");
  });

  test("presentSessionsOutput renders command presentation block", () => {
    const store = createStore({
      activeSessionId: "sess_aaaa1111",
      sessions: [createSession({ id: "sess_aaaa1111", title: "First" })],
    });
    const rendered = presentSessionsOutput(store, 10);
    expect(rendered).toContain("Sessions 1");
    expect(rendered).toContain("● sess_aaaa1111  First");
  });

  test("presentTokensOutput renders empty-state command presentation block", () => {
    const rendered = presentTokensOutput(null, []);
    expect(rendered).toBe("No token data yet. Send a prompt first.");
  });

  test("formatTokenUsageOutput shows latest session warning even when last turn has none", () => {
    const warned: SessionTokenUsageEntry = {
      id: "row_warned",
      usage: {
        promptTokens: 950,
        completionTokens: 30,
        totalTokens: 980,
      },
      warning: "context near budget (950/1000 tokens)",
    };
    const clean: SessionTokenUsageEntry = {
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
    const tokenUsage: SessionTokenUsageEntry[] = [
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
    expect(rows.some((row) => row.role === "system" && row.content.includes("last turn:"))).toBe(true);
    expect(rows.some((row) => row.content.includes("model calls:") && row.content.includes("last=5 session=7"))).toBe(
      true,
    );
  });

  test("dispatchSlashCommand handles /tokens with empty usage", async () => {
    const { rows, stop } = await runCommand("/tokens");

    expect(stop).toBe(true);
    expect(rows.some((row) => row.content === "No token data yet. Send a prompt first.")).toBe(true);
  });

  test("dispatchSlashCommand handles /status", async () => {
    const { rows, stop } = await runCommand("/status");
    expect(stop).toBe(true);
    expect(rows.some((row) => row.role === "system" && row.content.includes("providers:"))).toBe(true);
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

  test("dispatchSlashCommand updates default model via /model <id>", async () => {
    const previousModel = appConfig.model;
    const writes: Array<{ key: string; value: string; scope: ConfigScope }> = [];
    try {
      const { rows, stop } = await runCommand("/model gpt-5.2", {
        persistModelConfig: async (key, value, scope) => {
          writes.push({ key, value, scope });
        },
      });
      expect(stop).toBe(true);
      expect(rows.some((row) => row.content === "Changed default model to gpt-5.2.")).toBe(true);
      expect(writes).toEqual([{ key: "model", value: "gpt-5.2", scope: "project" }]);
      expect(appConfig.model).toBe("gpt-5.2");
    } finally {
      (appConfig as { model: string }).model = previousModel;
    }
  });

  test("dispatchSlashCommand updates mode model via /model <mode> <id>", async () => {
    const previousModeModel = appConfig.models.verify;
    const writes: Array<{ key: string; value: string; scope: ConfigScope }> = [];
    try {
      const { rows, stop } = await runCommand("/model verify gpt-5-nano", {
        persistModelConfig: async (key, value, scope) => {
          writes.push({ key, value, scope });
        },
      });
      expect(stop).toBe(true);
      expect(rows.some((row) => row.content === "Changed verify mode model to gpt-5-nano.")).toBe(true);
      expect(writes).toEqual([{ key: "models.verify", value: "gpt-5-nano", scope: "project" }]);
      expect(appConfig.models.verify).toBe("gpt-5-nano");
    } finally {
      const mutableModels = appConfig.models as Record<string, string>;
      if (previousModeModel) {
        mutableModels.verify = previousModeModel;
      } else {
        delete mutableModels.verify;
      }
    }
  });

  test("dispatchSlashCommand opens mode-scoped model picker with /model <mode>", async () => {
    const result = await runCommand("/model verify");
    expect(result.stop).toBe(true);
    expect(result.openedModel).toBe(true);
    expect(result.openedModelMode).toBe("verify");
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
  });

  test("dispatchSlashCommand /resume opens picker flow", async () => {
    const { rows, stop } = await runCommand("/resume");
    expect(stop).toBe(true);
    expect(rows.every((row) => row.role !== "user")).toBe(true);
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
        createMessage: (role, content) => ({ id: "msg_test", role, content, timestamp: "2026-02-20T00:00:00.000Z" }),
      });
      expect(result.stop).toBe(true);
      expect(assistantTurnTexts).toEqual(["Run the demo skill."]);
    });

    test("unknown /xyz still shows unknown command", async () => {
      resetSkillCache();
      const { rows, stop } = await runCommand("/xyz");
      expect(stop).toBe(true);
      expect(rows.some((r) => r.content.includes("Unknown command"))).toBe(true);
    });
  });
});
