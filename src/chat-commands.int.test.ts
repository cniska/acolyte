import { afterEach, describe, expect, test } from "bun:test";
import { appConfig } from "./app-config";
import { dispatchSlashCommand } from "./chat-commands";
import { loadSkills, resetSkillCache } from "./skills";
import { createCommandContext, createSession, createSessionState, tempDir, writeSkill } from "./test-utils";

async function runCommand(text: string, overrides: Parameters<typeof createCommandContext>[1] = {}) {
  const { ctx, spies } = createCommandContext(text, overrides);
  const result = await dispatchSlashCommand(ctx);
  return { ...spies, stop: result.stop, userText: result.userText };
}

function setParallelWorkspacesEnabled(enabled: boolean): () => void {
  const cfg = appConfig as unknown as { features: { parallelWorkspaces: boolean } };
  const prev = cfg.features.parallelWorkspaces;
  cfg.features.parallelWorkspaces = enabled;
  return () => {
    cfg.features.parallelWorkspaces = prev;
  };
}

describe("chat-commands", () => {
  describe("/workspaces", () => {
    test("new reports errors from worktree creation instead of throwing", async () => {
      const restore = setParallelWorkspacesEnabled(true);
      try {
        const sessionState = createSessionState({ sessions: [], activeSessionId: undefined });
        const { createDir, cleanupDirs } = tempDir();
        const tmp = createDir("acolyte-workspaces-nogit-");
        const currentSession = createSession({ id: "sess_current", workspace: tmp });
        const { rows, stop } = await runCommand("/workspaces new fix-auth", { sessionState, currentSession });
        expect(stop).toBe(true);
        expect(
          rows.some((row) => typeof row.content === "string" && row.content.startsWith("Failed to create workspace:")),
        ).toBe(true);
        expect(sessionState.sessions.length).toBe(0);
        cleanupDirs();
      } finally {
        restore();
      }
    });
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
