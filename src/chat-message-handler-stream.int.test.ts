import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-contract";
import { isToolOutput } from "./chat-contract";
import { createMessageHandler } from "./chat-message-handler";
import type { StreamEvent } from "./client-contract";
import { createClient, createMessage, createMessageHandlerHarness, createSession, createStore } from "./test-utils";

describe("chat message handler stream behavior", () => {
  test("streams tool-call events into tool progress rows", async () => {
    const { handleMessage, rows, calls } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (_input, options) => {
          options.onEvent({ type: "status", state: { kind: "running" } });
          options.onEvent({
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "shell-run",
            args: { cmd: "echo", args: ["hi"] },
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_1",
            toolName: "shell-run",
            content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "echo hi" },
          });
          options.onEvent({ type: "text-delta", text: "done" });
          return { state: "done" as const, model: "gpt-5-mini", output: "done" };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("hello");

    expect(calls.pendingStates[0]).toEqual({ kind: "running" });
    expect(calls.pendingStates.at(-1)).toBeNull();
    expect(rows.some((row) => row.kind === "tool")).toBe(true);
    expect(
      rows.some((row) => row.kind === "system" && typeof row.content === "string" && row.content.includes("Working")),
    ).toBe(false);
  });

  test("does not add generic tool rows when progress stream is empty", async () => {
    const { handleMessage, rows, session } = createMessageHandlerHarness({
      client: createClient({
        reply: async () => ({
          state: "done" as const,
          model: "gpt-5-mini",
          output: "done",
          toolCalls: ["shell-run"],
        }),
        status: async () => ({}),
      }),
    });

    await handleMessage("hello");

    expect(rows.some((row) => row.kind === "tool")).toBe(false);
    expect(session.messages.some((m) => m.role === "assistant" && m.content === "done")).toBe(true);
  });

  test("suppresses empty discovery/read tool rows when no body output arrives", async () => {
    const { handleMessage, rows, session } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          options.onEvent({
            type: "tool-call",
            toolCallId: "call_search",
            toolName: "file-search",
            args: { pattern: "needle" },
          });
          options.onEvent({
            type: "tool-result",
            toolCallId: "call_search",
            toolName: "file-search",
            isError: false,
          });
          options.onEvent({ type: "text-delta", text: "No matches found." });
          return { state: "done" as const, model: "gpt-5-mini", output: "No matches found." };
        },
      }),
    });

    await handleMessage("search for needle");

    expect(rows.some((row) => row.kind === "tool")).toBe(false);
    expect(session.messages.some((m) => m.role === "assistant" && m.content === "No matches found.")).toBe(true);
  });

  test("maps quota errors to user-facing message handler error", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        reply: async () => {
          throw new Error("insufficient_quota: You exceeded your current quota");
        },
      }),
    });

    await handleMessage("hello");

    expect(
      rows.some(
        (row) =>
          row.kind === "system" && typeof row.content === "string" && row.content.includes("Provider quota exceeded"),
      ),
    ).toBe(true);
  });

  test("maps timeout errors to user-facing message handler error", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        reply: async () => {
          throw new Error("Remote server stream timed out after 120000ms");
        },
      }),
    });

    await handleMessage("hello");

    expect(
      rows.some(
        (row) =>
          row.kind === "system" && typeof row.content === "string" && row.content.includes("Server request timed out"),
      ),
    ).toBe(true);
  });

  test("recovers cleanly after timeout and allows next message", async () => {
    let callCount = 0;
    const {
      handleMessage,
      rows,
      session,
      calls: spies,
    } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          callCount += 1;
          if (callCount === 1) throw new Error("Remote server stream timed out after 120000ms");
          options.onEvent({ type: "text-delta", text: "ok" });
          return { state: "done" as const, model: "gpt-5-mini", output: "ok" };
        },
      }),
    });

    await handleMessage("first");
    await handleMessage("second");

    expect(callCount).toBe(2);
    expect(spies.pendingTransitions).toEqual([true, false, true, false]);
    expect(
      rows.some(
        (row) =>
          row.kind === "system" && typeof row.content === "string" && row.content.includes("Server request timed out"),
      ),
    ).toBe(true);
    expect(session.messages.some((m) => m.role === "assistant" && m.content === "ok")).toBe(true);
  });

  test("keeps thinking indicator active while remote task is still running", async () => {
    let statusChecks = 0;
    const { handleMessage, calls } = createMessageHandlerHarness({
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
    });

    await handleMessage("first");
    expect(calls.pendingTransitions).toEqual([true]);
    expect(calls.pendingStates).toContainEqual({ kind: "running" });
    await Bun.sleep(800);
    expect(calls.pendingTransitions).toEqual([true, false]);
  });

  test("allows /new recovery after a timed-out turn", async () => {
    let replyCalls = 0;
    const { handleMessage, allRows, store, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        reply: async () => {
          replyCalls += 1;
          throw new Error("Remote server stream timed out after 120000ms");
        },
      }),
    });

    await handleMessage("first");
    await handleMessage("/new");

    expect(replyCalls).toBe(1);
    expect(
      allRows.some(
        (row) =>
          row.kind === "system" && typeof row.content === "string" && row.content.includes("Server request timed out"),
      ),
    ).toBe(true);
    expect(calls.setCurrentSessionIds.length).toBe(1);
    expect(store.activeSessionId).toBe(calls.setCurrentSessionIds[0]);
  });

  test("allows /resume recovery after a timed-out turn", async () => {
    const target = createSession({
      id: "sess_resume_target",
      messages: [createMessage("assistant", "resumed")],
    });
    const session = createSession({ id: "sess_current" });
    const store = createStore({ activeSessionId: session.id, sessions: [session, target] });
    let replyCalls = 0;
    const { handleMessage, rows, allRows, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        reply: async () => {
          replyCalls += 1;
          throw new Error("Remote server stream timed out after 120000ms");
        },
      }),
      session,
      store,
      toRows: (messages) => messages.map((msg) => ({ id: msg.id, kind: msg.role, content: msg.content })),
    });

    await handleMessage("first");
    await handleMessage(`/resume ${target.id.slice(0, 12)}`);

    expect(replyCalls).toBe(1);
    expect(
      allRows.some(
        (row) =>
          row.kind === "system" && typeof row.content === "string" && row.content.includes("Server request timed out"),
      ),
    ).toBe(true);
    expect(calls.setCurrentSessionIds).toEqual([target.id]);
    expect(store.activeSessionId).toBe(target.id);
    expect(rows.some((row) => row.kind === "assistant" && row.content === "resumed")).toBe(true);
  });

  test("uses final reply output as authoritative content", async () => {
    const finalOutput = "This is a long streamed answer";
    const { handleMessage, session } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [
          { type: "text-delta", text: "This is a long streamed answer that should not be truncated at finalize." },
        ],
        reply: async () => ({
          state: "done" as const,
          model: "gpt-5-mini",
          output: finalOutput,
        }),
      }),
    });

    await handleMessage("hello");

    expect(session.messages.some((message) => message.role === "assistant" && message.content === finalOutput)).toBe(
      true,
    );
  });

  test("suppresses guard-blocked tool attempts", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [
          { type: "tool-call", toolCallId: "call_1", toolName: "file-read", args: { paths: [{ path: "a.ts" }] } },
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "file-read",
            isError: true,
            errorCode: "E_GUARD_BLOCKED",
            error: { code: "E_GUARD_BLOCKED", category: "guard-blocked" },
          },
        ],
        reply: async () => ({
          state: "done" as const,
          model: "gpt-5-mini",
          output: "done",
        }),
      }),
    });

    await handleMessage("hello");

    const toolRows = rows.filter((row) => row.kind === "tool");
    expect(toolRows).toHaveLength(0);
  });

  test("never surfaces blocked tool rows when mixed with allowed tool work", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [
          { type: "tool-call", toolCallId: "call_blocked", toolName: "file-read", args: { paths: [{ path: "a.ts" }] } },
          {
            type: "tool-result",
            toolCallId: "call_blocked",
            toolName: "file-read",
            isError: true,
            errorCode: "E_GUARD_BLOCKED",
            error: { code: "E_GUARD_BLOCKED", category: "guard-blocked" },
          },
          { type: "tool-call", toolCallId: "call_ok", toolName: "file-edit", args: { path: "b.ts" } },
          {
            type: "tool-output",
            toolCallId: "call_ok",
            toolName: "file-edit",
            content: { kind: "tool-header", labelKey: "tool.label.file_edit", detail: "b.ts" },
          },
          {
            type: "tool-output",
            toolCallId: "call_ok",
            toolName: "file-edit",
            content: { kind: "diff", lineNumber: 2, marker: "add", text: "export const b = 2;" },
          },
        ],
        reply: async () => ({
          state: "done" as const,
          model: "gpt-5-mini",
          output: "done",
        }),
      }),
    });

    await handleMessage("hello");

    const toolRows = rows.filter((row) => row.kind === "tool");
    expect(toolRows).toHaveLength(1);
    expect(
      isToolOutput(toolRows[0]?.content) &&
        toolRows[0]?.content.parts.some(
          (item) => item.kind === "tool-header" && item.labelKey === "tool.label.file_edit",
        ),
    ).toBe(true);
    expect(
      rows.some((row) => isToolOutput(row.content) && row.content.parts.some((item) => item.kind === "file-header")),
    ).toBe(false);
  });

  test("does not merge tool rows across separate user turns", async () => {
    const replies = [
      { state: "done" as const, model: "gpt-5-mini", output: "first done" },
      { state: "done" as const, model: "gpt-5-mini", output: "second done" },
    ];
    const eventsByTurn: StreamEvent[][] = [
      [
        { type: "tool-call", toolCallId: "call_1", toolName: "file-edit", args: { path: "sum.rs" } },
        {
          type: "tool-output",
          toolCallId: "call_1",
          toolName: "file-edit",
          content: { kind: "tool-header", labelKey: "tool.label.file_edit", detail: "sum.rs" },
        },
        {
          type: "tool-output",
          toolCallId: "call_1",
          toolName: "file-edit",
          content: { kind: "diff", lineNumber: 1, marker: "add", text: "fn main() {}" },
        },
      ],
      [
        { type: "tool-call", toolCallId: "call_2", toolName: "file-edit", args: { path: "sum.rs" } },
        {
          type: "tool-output",
          toolCallId: "call_2",
          toolName: "file-edit",
          content: { kind: "tool-header", labelKey: "tool.label.file_edit", detail: "sum.rs" },
        },
        {
          type: "tool-output",
          toolCallId: "call_2",
          toolName: "file-edit",
          content: { kind: "diff", lineNumber: 2, marker: "add", text: 'println!("ok");' },
        },
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
          return replies[turn] ?? { state: "done" as const, model: "gpt-5-mini", output: "done" };
        },
      }),
    });

    await handleMessage("create file");
    await handleMessage("edit file");

    const editedRows = rows.filter(
      (row) =>
        row.kind === "tool" &&
        isToolOutput(row.content) &&
        row.content.parts.some((item) => item.kind === "tool-header" && item.labelKey === "tool.label.file_edit"),
    );
    expect(editedRows).toHaveLength(2);
  });

  test("persists token usage on successful turn", async () => {
    const { handleMessage, session, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        reply: async () => ({
          state: "done" as const,
          model: "gpt-5-mini",
          output: "done",
          usage: {
            inputTokens: 12,
            outputTokens: 8,
            totalTokens: 20,
          },
          modelCalls: 3,
        }),
      }),
    });

    await handleMessage("hello");

    expect(session.tokenUsage.length).toBe(1);
    expect(session.tokenUsage[0]?.usage.totalTokens).toBe(20);
    expect(session.tokenUsage[0]?.modelCalls).toBe(3);
    expect(calls.tokenUsageSnapshots.length).toBe(1);
    expect(calls.tokenUsageSnapshots[0]).toEqual(session.tokenUsage);
  });

  test("streams text-delta events after resuming a different session", async () => {
    const sessionA = createSession({ id: "sess_A" });
    const sessionB = createSession({
      id: "sess_resume_B",
      messages: [createMessage("assistant", "old reply")],
    });
    const store = createStore({ activeSessionId: sessionA.id, sessions: [sessionA, sessionB] });
    const rows: ChatRow[] = [];
    const allRows: ChatRow[] = [];
    let replyCount = 0;

    const client = createClient({
      status: async () => ({}),
      replyStream: async (_input, options) => {
        replyCount += 1;
        options.onEvent({ type: "status", state: { kind: "running" } });
        options.onEvent({ type: "text-delta", text: `reply-${replyCount}` });
        return { state: "done" as const, model: "gpt-5-mini", output: `reply-${replyCount}` };
      },
    });

    const setRows = (updater: (current: ChatRow[]) => ChatRow[]) => {
      const next = updater(rows);
      rows.splice(0, rows.length, ...next);
      for (const row of next) {
        if (!allRows.includes(row)) allRows.push(row);
      }
    };

    let currentSession = sessionA;

    // Simulate React behavior: create handler with current session
    const makeHandler = () =>
      createMessageHandler({
        client,
        store,
        currentSession,
        setCurrentSession: (next) => {
          currentSession = next;
        },
        toRows: (messages) => messages.map((msg) => ({ id: msg.id, kind: msg.role, content: msg.content })),
        setRows,
        setShowHelp: () => {},
        setValue: () => {},
        persist: async () => {},
        exit: () => {},
        openSkillsPanel: async () => {},
        activateSkill: async () => true,
        openResumePanel: () => {},
        openModelPanel: () => {},
        tokenUsage: [],
        isPending: false,
        setInputHistory: () => {},
        setInputHistoryIndex: () => {},
        setInputHistoryDraft: () => {},
        setPendingState: () => {},
        setRunningUsage: () => {},
        setTokenUsage: () => {},
        createMessage,
        nowIso: () => "2026-02-20T00:00:00.000Z",
        setInterrupt: () => {},
        clearTranscript: () => {
          rows.splice(0, rows.length);
        },
      });

    // Turn 1: send message in session A — streaming works
    let handler = makeHandler();
    await handler.handleSubmit("hello from A");
    expect(replyCount).toBe(1);
    expect(rows.some((row) => row.kind === "assistant" && row.content === "reply-1")).toBe(true);

    // Resume to session B (simulates /resume + React re-render)
    currentSession = sessionB;
    store.activeSessionId = sessionB.id;
    rows.splice(0, rows.length);

    // Recreate handler with new session (simulates React re-render)
    handler = makeHandler();

    // Turn 2: send message in resumed session B — streaming should work
    await handler.handleSubmit("hello from B");
    expect(replyCount).toBe(2);

    // The key assertion: the reply from session B appears in rows
    expect(rows.some((row) => row.kind === "assistant" && row.content === "reply-2")).toBe(true);
    // Session B's history should include the new user message
    expect(currentSession.messages.some((msg) => msg.role === "user" && msg.content === "hello from B")).toBe(true);
  });

  test("assistant text row stays before tool rows after finalization", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (_input, options) => {
          options.onEvent({ type: "status", state: { kind: "running" } });
          options.onEvent({ type: "text-delta", text: "I will run the command." });
          options.onEvent({
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "shell-run",
            args: { cmd: "echo", args: ["hi"] },
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_1",
            toolName: "shell-run",
            content: { kind: "tool-header", labelKey: "tool.label.shell_run", detail: "echo hi" },
          });
          options.onEvent({
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "shell-run",
          });
          return { state: "done" as const, model: "gpt-5-mini", output: "I will run the command." };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("do something");

    const assistantIndex = rows.findIndex((row) => row.kind === "assistant");
    const toolIndex = rows.findIndex((row) => row.kind === "tool");
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeLessThan(toolIndex);
  });

  test("batched tool calls each get their own tool row", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (_input, options) => {
          options.onEvent({ type: "status", state: { kind: "running" } });
          // Two tool calls in the same batch, different toolCallIds
          options.onEvent({
            type: "tool-call",
            toolCallId: "call_A",
            toolName: "code-edit",
            args: { path: "a.ts" },
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_A",
            toolName: "code-edit",
            content: {
              kind: "edit-header",
              labelKey: "tool.label.file_edit",
              path: "a.ts",
              files: 1,
              added: 1,
              removed: 1,
            },
          });
          options.onEvent({
            type: "tool-result",
            toolCallId: "call_A",
            toolName: "code-edit",
          });
          options.onEvent({
            type: "tool-call",
            toolCallId: "call_B",
            toolName: "code-edit",
            args: { path: "b.ts" },
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_B",
            toolName: "code-edit",
            content: {
              kind: "edit-header",
              labelKey: "tool.label.file_edit",
              path: "b.ts",
              files: 1,
              added: 1,
              removed: 1,
            },
          });
          options.onEvent({
            type: "tool-result",
            toolCallId: "call_B",
            toolName: "code-edit",
          });
          return { state: "done" as const, model: "gpt-5-mini", output: "done" };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("rename across files");

    const toolRows = rows.filter((row) => row.kind === "tool");
    expect(toolRows).toHaveLength(2);
  });
});
