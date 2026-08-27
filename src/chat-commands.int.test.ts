import { afterEach, describe, expect, test } from "bun:test";
import { appConfig } from "./app-config";
import { findCommandEntry } from "./chat-command-registry";
import { dispatchSlashCommand } from "./chat-commands";
import { loadSkills, resetSkillCache } from "./skill-ops";
import { createCommandContext, createSession, createSessionState, tempDir, writeSkill } from "./test-utils";

async function runCommand(text: string, overrides: Parameters<typeof createCommandContext>[1] = {}) {
  const { ctx, spies } = createCommandContext(text, overrides);
  const result = await dispatchSlashCommand(ctx);
  return { ...spies, stop: result.stop, userText: result.userText };
}

function setWorkspacesEnabled(enabled: boolean): () => void {
  const cfg = appConfig as unknown as { features: { workspaces: boolean } };
  const prev = cfg.features.workspaces;
  cfg.features.workspaces = enabled;
  return () => {
    cfg.features.workspaces = prev;
  };
}

describe("chat-commands", () => {
  describe("/workspaces", () => {
    test("new reports errors from worktree creation instead of throwing", async () => {
      const restore = setWorkspacesEnabled(true);
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

    test("/skill:name with args continues to agent turn", async () => {
      const tmpDir = createDir("acolyte-cmd-skill-");
      writeSkill(tmpDir, "demo", "---\nname: demo\ndescription: Demo\n---", "# Demo");
      await loadSkills(tmpDir);

      const activated: string[] = [];
      const result = await runCommand("/skill:demo run tests", {
        activateSkill: async (name, args) => {
          activated.push(name, args);
          return true;
        },
      });
      expect(result.stop).toBe(false);
      expect(activated).toEqual(["demo", "run tests"]);
    });

    test("/skill:name without args starts assistant turn directly", async () => {
      const tmpDir = createDir("acolyte-cmd-skill-");
      writeSkill(tmpDir, "demo", "---\nname: demo\ndescription: Demo\n---", "# Demo");
      await loadSkills(tmpDir);

      const assistantTurnTexts: string[] = [];
      const result = await runCommand("/skill:demo", {
        activateSkill: async () => true,
        startAssistantTurn: async (text) => {
          assistantTurnTexts.push(text);
        },
      });
      expect(result.stop).toBe(true);
      expect(assistantTurnTexts).toEqual(["Run the demo skill."]);
    });

    test("a skill entry is marked a skill and a builtin is not", async () => {
      const tmpDir = createDir("acolyte-cmd-skill-");
      writeSkill(tmpDir, "demo", "---\nname: demo\ndescription: Demo\n---", "# Demo");
      await loadSkills(tmpDir);

      expect(findCommandEntry("skill:demo")?.isSkill).toBe(true);
      expect(findCommandEntry("status")?.isSkill).toBeUndefined();
    });

    test("unknown /xyz still shows unknown command", async () => {
      resetSkillCache();
      const { rows, stop } = await runCommand("/xyz");
      expect(stop).toBe(true);
      expect(rows.some((r) => typeof r.content === "string" && r.content.includes("Unknown command"))).toBe(true);
    });
  });
});
