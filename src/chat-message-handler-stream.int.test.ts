import { describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatRow } from "./chat-commands";
import { buildInternalWriteResumeTurn, resolveNaturalRememberDirective } from "./chat-message-handler-helpers";
import {
  createMessageHandler,
} from "./chat-message-handler";
import type { StreamEvent } from "./client";
import {
  createClient,
  createMessage,
  createSession,
  createStore,
  createMessageHandlerHarness,
  dedent,
} from "./test-utils";

describe("chat message handler stream behavior", () => {
  test("streams tool-call events into tool progress rows", async () => {
    const rows: ChatRow[] = [];
    const progressTexts: Array<string | null> = [];

    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });

    const handleMessage = createMessageHandler({
      client: createClient({
        replyStream: async (_input, options) => {
          options.onEvent({ type: "status", message: "Thinking…" });
          options.onEvent({
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "run-command",
            args: { command: "echo hi" },
          });
          return { model: "gpt-5-mini", output: "done" };
        },
        status: async () => ({}),
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      activateSkill: async () => true,
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openModelPanel: () => {},
      openWriteConfirmPanel: () => {},
      tokenUsage: [],
      isWorking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsWorking: () => {},
      setProgressText: (next) => {
        progressTexts.push(next);
      },
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await handleMessage("hello");

    expect(progressTexts[0]).toBe("Thinking…");
    expect(progressTexts.at(-1)).toBeNull();
    expect(rows.some((row) => row.role === "assistant" && row.style === "toolProgress")).toBe(true);
    expect(rows.some((row) => row.role === "system" && row.content.includes("Thinking…"))).toBe(false);
    expect(rows.some((row) => row.role === "assistant" && row.content === "done")).toBe(true);
  });

  test("does not add generic tool rows when progress stream is empty", async () => {
    const rows: ChatRow[] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });

    const handleMessage = createMessageHandler({
      client: createClient({
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
          toolCalls: ["run-command"],
        }),
        status: async () => ({}),
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      activateSkill: async () => true,
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openModelPanel: () => {},
      openWriteConfirmPanel: () => {},
      tokenUsage: [],
      isWorking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsWorking: () => {},
      setProgressText: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await handleMessage("hello");

    expect(rows.some((row) => row.role === "assistant" && row.style === "toolProgress")).toBe(false);
    expect(rows.some((row) => row.role === "assistant" && row.content === "done")).toBe(true);
  });

  test("suppresses empty discovery/read tool rows when no body output arrives", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          options.onEvent({
            type: "tool-call",
            toolCallId: "call_search",
            toolName: "search-files",
            args: { pattern: "needle" },
          });
          options.onEvent({
            type: "tool-result",
            toolCallId: "call_search",
            toolName: "search-files",
            isError: false,
          });
          return { model: "gpt-5-mini", output: "No matches found." };
        },
      }),
    });

    await handleMessage("search for needle");

    expect(
      rows.some((row) => row.role === "assistant" && row.style === "toolProgress" && row.toolName === "search-files"),
    ).toBe(false);
    expect(rows.some((row) => row.role === "assistant" && row.content === "No matches found.")).toBe(true);
  });

  test("maps quota errors to user-facing message handler error", async () => {
    const rows: ChatRow[] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const handleMessage = createMessageHandler({
      client: createClient({
        status: async () => ({}),
        reply: async () => {
          throw new Error("insufficient_quota: You exceeded your current quota");
        },
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      activateSkill: async () => true,
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openModelPanel: () => {},
      openWriteConfirmPanel: () => {},
      tokenUsage: [],
      isWorking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsWorking: () => {},
      setProgressText: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await handleMessage("hello");

    expect(rows.some((row) => row.role === "system" && row.content.includes("Provider quota exceeded"))).toBe(true);
  });

  test("maps timeout errors to user-facing message handler error", async () => {
    const rows: ChatRow[] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const handleMessage = createMessageHandler({
      client: createClient({
        status: async () => ({}),
        reply: async () => {
          throw new Error("Remote server stream timed out after 120000ms");
        },
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      activateSkill: async () => true,
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openModelPanel: () => {},
      openWriteConfirmPanel: () => {},
      tokenUsage: [],
      isWorking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsWorking: () => {},
      setProgressText: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await handleMessage("hello");

    expect(rows.some((row) => row.role === "system" && row.content.includes("Server request timed out"))).toBe(true);
  });

  test("recovers cleanly after timeout and allows next message", async () => {
    const rows: ChatRow[] = [];
    const thinkingTransitions: boolean[] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    let calls = 0;
    const handleMessage = createMessageHandler({
      client: createClient({
        status: async () => ({}),
        reply: async () => {
          calls += 1;
          if (calls === 1) throw new Error("Remote server stream timed out after 120000ms");
          return { model: "gpt-5-mini", output: "ok" };
        },
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      activateSkill: async () => true,
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openModelPanel: () => {},
      openWriteConfirmPanel: () => {},
      tokenUsage: [],
      isWorking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsWorking: (next) => {
        thinkingTransitions.push(next);
      },
      setProgressText: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await handleMessage("first");
    await handleMessage("second");

    expect(calls).toBe(2);
    expect(thinkingTransitions).toEqual([true, false, true, false]);
    expect(rows.some((row) => row.role === "system" && row.content.includes("Server request timed out"))).toBe(true);
    expect(rows.some((row) => row.role === "assistant" && row.content === "ok")).toBe(true);
  });

  test("keeps thinking indicator active while remote task is still running", async () => {
    const rows: ChatRow[] = [];
    const thinkingTransitions: boolean[] = [];
    const progressTransitions: Array<string | null> = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    let statusChecks = 0;
    const handleMessage = createMessageHandler({
      client: createClient({
        status: async () => ({}),
        reply: async () => {
          throw Object.assign(new Error("RPC stream closed before final reply"), { taskId: "rpc_task_1" });
        },
        taskStatus: async () => {
          statusChecks += 1;
          if (statusChecks === 1) {
            return {
              id: "rpc_task_1",
              state: "running",
              createdAt: "2026-02-20T00:00:00.000Z",
              updatedAt: "2026-02-20T00:00:01.000Z",
            };
          }
          return {
            id: "rpc_task_1",
            state: "completed",
            createdAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-20T00:00:02.000Z",
            summary: "done",
          };
        },
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      activateSkill: async () => true,
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openModelPanel: () => {},
      openWriteConfirmPanel: () => {},
      tokenUsage: [],
      isWorking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsWorking: (next) => {
        thinkingTransitions.push(next);
      },
      setProgressText: (next) => {
        progressTransitions.push(next);
      },
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await handleMessage("first");
    expect(thinkingTransitions).toEqual([true]);
    expect(progressTransitions).toContain("Still running on server…");
    await Bun.sleep(800);
    expect(thinkingTransitions).toEqual([true, false]);
  });

  test("allows /new recovery after a timed-out turn", async () => {
    const rows: ChatRow[] = [];
    let sawTimeoutRow = false;
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const setCurrentSessionCalls: string[] = [];
    let calls = 0;
    const handleMessage = createMessageHandler({
      client: createClient({
        status: async () => ({}),
        reply: async () => {
          calls += 1;
          throw new Error("Remote server stream timed out after 120000ms");
        },
      }),
      store,
      currentSession: session,
      setCurrentSession: (next) => {
        setCurrentSessionCalls.push(next.id);
      },
      toRows: () => [],
      setRows: (updater) => {
        const next = updater(rows);
        if (next.some((row) => row.role === "system" && row.content.includes("Server request timed out")))
          sawTimeoutRow = true;
        rows.splice(0, rows.length, ...next);
      },
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      activateSkill: async () => true,
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openModelPanel: () => {},
      openWriteConfirmPanel: () => {},
      tokenUsage: [],
      isWorking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsWorking: () => {},
      setProgressText: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await handleMessage("first");
    await handleMessage("/new");

    expect(calls).toBe(1);
    expect(sawTimeoutRow).toBe(true);
    expect(rows.some((row) => row.role === "system" && row.content.startsWith("Started new session: sess_"))).toBe(
      true,
    );
    expect(setCurrentSessionCalls.length).toBe(1);
    expect(store.activeSessionId).toBe(setCurrentSessionCalls[0]);
  });

  test("allows /resume recovery after a timed-out turn", async () => {
    const rows: ChatRow[] = [];
    let sawTimeoutRow = false;
    const target = createSession({
      id: "sess_resume_target",
      messages: [createMessage("assistant", "resumed")],
    });
    const session = createSession({ id: "sess_current" });
    const store = createStore({ activeSessionId: session.id, sessions: [session, target] });
    const setCurrentSessionCalls: string[] = [];
    let calls = 0;
    const handleMessage = createMessageHandler({
      client: createClient({
        status: async () => ({}),
        reply: async () => {
          calls += 1;
          throw new Error("Remote server stream timed out after 120000ms");
        },
      }),
      store,
      currentSession: session,
      setCurrentSession: (next) => {
        setCurrentSessionCalls.push(next.id);
      },
      toRows: (messages) => messages.map((msg) => ({ id: msg.id, role: msg.role, content: msg.content })),
      setRows: (updater) => {
        const next = updater(rows);
        if (next.some((row) => row.role === "system" && row.content.includes("Server request timed out")))
          sawTimeoutRow = true;
        rows.splice(0, rows.length, ...next);
      },
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      activateSkill: async () => true,
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openModelPanel: () => {},
      openWriteConfirmPanel: () => {},
      tokenUsage: [],
      isWorking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsWorking: () => {},
      setProgressText: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await handleMessage("first");
    await handleMessage(`/resume ${target.id.slice(0, 12)}`);

    expect(calls).toBe(1);
    expect(sawTimeoutRow).toBe(true);
    expect(setCurrentSessionCalls).toEqual([target.id]);
    expect(store.activeSessionId).toBe(target.id);
    expect(rows.some((row) => row.role === "assistant" && row.content === "resumed")).toBe(true);
  });

  test("creates a single tool row per streamed tool-call event", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [{ type: "tool-call", toolCallId: "call_1", toolName: "run-command", args: { command: "echo hi" } }],
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
        }),
      }),
    });

    await handleMessage("hello");

    const runRows = rows.filter(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content.startsWith("Run"),
    );
    expect(runRows.length).toBe(1);
    expect(runRows[0]?.content).toBe("Run echo hi\n(No output)");
  });

  test("renders streamed tool rows before assistant summary row", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [
          { type: "tool-call", toolCallId: "call_1", toolName: "edit-file", args: { path: "sum.rs" } },
          { type: "tool-output", toolCallId: "call_1", toolName: "edit-file", content: "1 + fn main() {}" },
        ],
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
        }),
      }),
    });

    await handleMessage("hello");

    const toolIndex = rows.findIndex(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content.startsWith("Edit sum.rs"),
    );
    const assistantIndex = rows.findIndex((row) => row.role === "assistant" && row.content === "done");
    expect(toolIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeLessThan(assistantIndex);
  });

  test("keeps full streamed assistant output when final reply is shorter", async () => {
    const streamed = "This is a long streamed answer that should not be truncated at finalize.";
    const { handleMessage, rows, session } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [{ type: "text-delta", text: streamed }],
        reply: async () => ({
          model: "gpt-5-mini",
          output: "This is a long streamed answer",
        }),
      }),
    });

    await handleMessage("hello");

    expect(rows.some((row) => row.role === "assistant" && row.content === streamed)).toBe(true);
    expect(session.messages.some((message) => message.role === "assistant" && message.content === streamed)).toBe(true);
  });

  test("creates a single tool row when tool-call is followed by tool-result", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [
          { type: "tool-call", toolCallId: "call_1", toolName: "edit-file", args: { path: "sum.rs" } },
          { type: "tool-result", toolCallId: "call_1", toolName: "edit-file" },
        ],
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
        }),
      }),
    });

    await handleMessage("hello");

    const editedRows = rows.filter(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content.startsWith("Edit sum.rs"),
    );
    expect(editedRows).toHaveLength(1);
    expect(editedRows[0]?.content).toBe("Edit sum.rs");
  });

  test("suppresses guard-blocked tool attempts", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [
          { type: "tool-call", toolCallId: "call_1", toolName: "read-file", args: { paths: [{ path: "a.ts" }] } },
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "read-file",
            isError: true,
            errorCode: "E_GUARD_BLOCKED",
            errorDetail: { code: "E_GUARD_BLOCKED", category: "guard-blocked" },
          },
        ],
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
        }),
      }),
    });

    await handleMessage("hello");

    const toolRows = rows.filter((row) => row.role === "assistant" && row.style === "toolProgress");
    expect(toolRows).toHaveLength(0);
  });

  test("never surfaces blocked tool rows when mixed with allowed tool work", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [
          { type: "tool-call", toolCallId: "call_blocked", toolName: "read-file", args: { paths: [{ path: "a.ts" }] } },
          {
            type: "tool-result",
            toolCallId: "call_blocked",
            toolName: "read-file",
            isError: true,
            errorCode: "E_GUARD_BLOCKED",
            errorDetail: { code: "E_GUARD_BLOCKED", category: "guard-blocked" },
          },
          { type: "tool-call", toolCallId: "call_ok", toolName: "edit-file", args: { path: "b.ts" } },
          { type: "tool-output", toolCallId: "call_ok", toolName: "edit-file", content: "2 + export const b = 2;" },
        ],
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
        }),
      }),
    });

    await handleMessage("hello");

    const toolRows = rows.filter((row) => row.role === "assistant" && row.style === "toolProgress");
    expect(toolRows.map((row) => row.content)).toEqual(["Edit b.ts\n2 + export const b = 2;"]);
    expect(rows.some((row) => row.content.includes("Read a.ts"))).toBe(false);
  });

  test("merges tool-output into tool-call row in real time", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [
          { type: "tool-call", toolCallId: "call_1", toolName: "edit-file", args: { path: "sum.rs" } },
          { type: "tool-output", toolCallId: "call_1", toolName: "edit-file", content: "1 + fn main() {}" },
        ],
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
        }),
      }),
    });

    await handleMessage("hello");

    const editedRows = rows.filter(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content.startsWith("Edit sum.rs"),
    );
    expect(editedRows).toHaveLength(1);
    expect(editedRows[0]?.content).toBe("Edit sum.rs\n1 + fn main() {}");
  });

  test("ignores duplicate tool-output lines for the same tool row", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [
          { type: "tool-call", toolCallId: "call_1", toolName: "edit-file", args: { path: "sum.rs" } },
          { type: "tool-output", toolCallId: "call_1", toolName: "edit-file", content: "1 + fn main() {}" },
          { type: "tool-output", toolCallId: "call_1", toolName: "edit-file", content: "1 + fn main() {}" },
        ],
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
        }),
      }),
    });

    await handleMessage("hello");

    const editedRows = rows.filter(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content.startsWith("Edit sum.rs"),
    );
    expect(editedRows).toHaveLength(1);
    expect(editedRows[0]?.content).toBe("Edit sum.rs\n1 + fn main() {}");
  });

  test("does not merge tool rows across separate user turns", async () => {
    const replies = [
      { model: "gpt-5-mini", output: "first done" },
      { model: "gpt-5-mini", output: "second done" },
    ];
    const eventsByTurn: StreamEvent[][] = [
      [
        { type: "tool-call", toolCallId: "call_1", toolName: "edit-file", args: { path: "sum.rs" } },
        { type: "tool-output", toolCallId: "call_1", toolName: "edit-file", content: "1 + fn main() {}" },
      ],
      [
        { type: "tool-call", toolCallId: "call_2", toolName: "edit-file", args: { path: "sum.rs" } },
        { type: "tool-output", toolCallId: "call_2", toolName: "edit-file", content: '2 + println!("ok");' },
      ],
    ];
    let replyCount = 0;
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          const turn = replyCount++;
          const events = eventsByTurn[turn] ?? [];
          for (const event of events) {
            options.onEvent(event);
          }
          return replies[turn] ?? { model: "gpt-5-mini", output: "done" };
        },
      }),
    });

    await handleMessage("create file");
    await handleMessage("edit file");

    const editedRows = rows.filter(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content.startsWith("Edit sum.rs"),
    );
    expect(editedRows).toHaveLength(2);
    expect(editedRows[0]?.content).toBe("Edit sum.rs\n1 + fn main() {}");
    expect(editedRows[1]?.content).toBe('Edit sum.rs\n2 + println!("ok");');
  });

  test("keeps same-header tool rows separate when toolCallId differs in one turn", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [
          { type: "tool-call", toolCallId: "call_1", toolName: "edit-file", args: { path: "sum.rs" } },
          { type: "tool-output", toolCallId: "call_1", toolName: "edit-file", content: "1 + fn one() {}" },
          { type: "tool-call", toolCallId: "call_2", toolName: "edit-file", args: { path: "sum.rs" } },
          { type: "tool-output", toolCallId: "call_2", toolName: "edit-file", content: "1 + fn two() {}" },
        ],
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
        }),
      }),
    });

    await handleMessage("hello");

    const editedRows = rows.filter(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content.startsWith("Edit sum.rs"),
    );
    expect(editedRows).toHaveLength(2);
    expect(editedRows[0]?.content).toBe("Edit sum.rs\n1 + fn one() {}");
    expect(editedRows[1]?.content).toBe("Edit sum.rs\n1 + fn two() {}");
  });

  test("persists token usage on successful turn", async () => {
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const tokenUsageSnapshots: Array<typeof session.tokenUsage> = [];

    const handleMessage = createMessageHandler({
      client: createClient({
        status: async () => ({}),
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
          usage: {
            promptTokens: 12,
            completionTokens: 8,
            totalTokens: 20,
          },
          modelCalls: 3,
        }),
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: () => {},
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      activateSkill: async () => true,
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openModelPanel: () => {},
      openWriteConfirmPanel: () => {},
      tokenUsage: [],
      isWorking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsWorking: () => {},
      setProgressText: () => {},
      setTokenUsage: (updater) => {
        tokenUsageSnapshots.push(updater([]));
      },
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await handleMessage("hello");

    expect(session.tokenUsage.length).toBe(1);
    expect(session.tokenUsage[0]?.usage.totalTokens).toBe(20);
    expect(session.tokenUsage[0]?.modelCalls).toBe(3);
    expect(tokenUsageSnapshots.length).toBe(1);
    expect(tokenUsageSnapshots[0]).toEqual(session.tokenUsage);
  });
});
