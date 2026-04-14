import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendInputHistory,
  applyUserTurn,
  createAtReferenceSuggestion,
  createInputHistory,
  runAssistantTurn,
} from "./chat-turn";
import type { Session } from "./session-contract";
import { tempDir } from "./test-utils";

describe("chat turn helpers", () => {
  test("appendInputHistory avoids duplicate consecutive entries", () => {
    expect(appendInputHistory(["hello"], "hello")).toEqual(["hello"]);
    expect(appendInputHistory(["hello"], "world")).toEqual(["hello", "world"]);
  });

  test("createInputHistory reconstructs user prompt history from messages", () => {
    const history = createInputHistory([
      { id: "m1", role: "system", content: "System context", timestamp: "2026-02-21T10:00:00.000Z" },
      { id: "m2", role: "user", content: "  hello  ", timestamp: "2026-02-21T10:00:01.000Z" },
      { id: "m3", role: "assistant", content: "Hi", timestamp: "2026-02-21T10:00:02.000Z" },
      { id: "m4", role: "user", content: "hello", timestamp: "2026-02-21T10:00:03.000Z" },
      { id: "m5", role: "user", content: "review @src/agent.ts", timestamp: "2026-02-21T10:00:04.000Z" },
      { id: "m6", role: "user", content: " ", timestamp: "2026-02-21T10:00:05.000Z" },
    ]);
    expect(history).toEqual(["hello", "review @src/agent.ts"]);
  });

  test("applyUserTurn creates display row and initializes title", () => {
    const session: Session = {
      id: "sess_1",
      title: "New Session",
      model: "gpt-5-mini",
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
      messages: [],
      tokenUsage: [],
    };
    const result = applyUserTurn({
      session,
      displayText: "hello there",
    });

    expect(session.title).toBe("hello there");
    expect(result.row.kind).toBe("user");
    expect(result.row.content).toBe("hello there");
  });

  describe("createAtReferenceSuggestion", () => {
    const { createDir, cleanupDirs } = tempDir();

    test("suggests code-scan for parseable code files", async () => {
      const root = createDir("acolyte-at-ref-code-");
      writeFileSync(join(root, "demo.ts"), "const x = 1;\n", "utf8");

      const result = await createAtReferenceSuggestion("review @demo.ts", { workspace: root });

      expect(result.suggestion).toContain("Use `code-scan` on demo.ts");
      expect(result.unresolvedPaths).toEqual([]);
      cleanupDirs();
    });

    test("suggests file-read for non-code files", async () => {
      const root = createDir("acolyte-at-ref-text-");
      writeFileSync(join(root, "config.json"), "{}\n", "utf8");

      const result = await createAtReferenceSuggestion("review @config.json", { workspace: root });

      expect(result.suggestion).toContain("Use `file-read` on config.json");
      expect(result.unresolvedPaths).toEqual([]);
      cleanupDirs();
    });

    test("suggests file-find for directories", async () => {
      const root = createDir("acolyte-at-ref-dir-");
      mkdirSync(join(root, "src"), { recursive: true });

      const result = await createAtReferenceSuggestion("review @src/", { workspace: root });

      expect(result.suggestion).toContain("Use `file-find` on src/");
      expect(result.unresolvedPaths).toEqual([]);
      cleanupDirs();
    });

    test("combines code-scan, file-read, and file-find in one suggestion", async () => {
      const root = createDir("acolyte-at-ref-mixed-");
      writeFileSync(join(root, "app.ts"), "export {}", "utf8");
      writeFileSync(join(root, "config.json"), "{}", "utf8");
      mkdirSync(join(root, "lib"), { recursive: true });

      const result = await createAtReferenceSuggestion("review @app.ts @config.json @lib/", {
        workspace: root,
      });

      expect(result.suggestion).toContain("Use `code-scan` on app.ts");
      expect(result.suggestion).toContain("Use `file-read` on config.json");
      expect(result.suggestion).toContain("Use `file-find` on lib/");
      expect(result.suggestion).toContain("before responding.");
      cleanupDirs();
    });

    test("returns null suggestion when no @ references", async () => {
      const result = await createAtReferenceSuggestion("just a normal message");
      expect(result.suggestion).toBeNull();
      expect(result.unresolvedPaths).toEqual([]);
    });

    test("reports unresolved paths for missing files", async () => {
      const root = createDir("acolyte-at-ref-missing-");
      const result = await createAtReferenceSuggestion("review @nonexistent.ts", {
        workspace: root,
      });
      expect(result.suggestion).toBeNull();
      expect(result.unresolvedPaths).toEqual(["nonexistent.ts"]);
      cleanupDirs();
    });
  });

  test("runAssistantTurn ignores reply progress payload rows", async () => {
    const turn = await runAssistantTurn({
      client: {
        replyStream: async () => ({
          state: "done" as const,
          model: "gpt-5-mini",
          output: "done",
        }),
        status: async () => ({}),
        taskStatus: async () => null,
      },
      userText: "create a rust script",
      history: [],
      model: "gpt-5-mini",
      sessionId: "sess_test",
      pendingStartedAt: Date.now(),
      createMessage: (role, content) => ({
        id: "msg_assistant",
        role,
        content,
        timestamp: "2026-02-20T00:00:00.000Z",
      }),
    });

    const toolRows = turn.rows.filter((row) => row.kind === "tool");
    expect(toolRows).toHaveLength(0);
    expect(turn.rows.every((row) => row.kind !== "assistant")).toBe(true);
    expect(turn.assistantMessage.content).toBe("done");
  });

  test("runAssistantTurn marks assistant message as tool_payload when tools were used", async () => {
    const turn = await runAssistantTurn({
      client: {
        replyStream: async () => ({
          state: "done" as const,
          model: "gpt-5-mini",
          output: "done",
          toolCalls: ["file-read"],
        }),
        status: async () => ({}),
        taskStatus: async () => null,
      },
      userText: "read src/agent.ts",
      history: [],
      model: "gpt-5-mini",
      sessionId: "sess_test",
      pendingStartedAt: Date.now(),
      createMessage: (role, content) => ({
        id: "msg_assistant",
        role,
        content,
        timestamp: "2026-02-20T00:00:00.000Z",
      }),
    });

    expect(turn.assistantMessage.kind).toBe("tool_payload");
  });
});
