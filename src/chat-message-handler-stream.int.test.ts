import { describe, expect, test } from "bun:test";
import { isToolOutput } from "./chat-contract";
import type { StreamEvent } from "./client-contract";
import { createClient, createMessage, createMessageHandlerHarness, createSession, createStore } from "./test-utils";

describe("chat message handler stream behavior", () => {
  test("streams tool-call events into tool progress rows", async () => {
    const { handleMessage, rows, calls } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (_input, options) => {
          options.onEvent({ type: "status", message: "Thinking…" });
          options.onEvent({
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "run-command",
            args: { command: "echo hi" },
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_1",
            toolName: "run-command",
            content: { kind: "tool-header", label: "Run", detail: "echo hi" },
          });
          return { model: "gpt-5-mini", output: "done" };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("hello");

    expect(calls.progressTexts[0]).toBe("Thinking…");
    expect(calls.progressTexts.at(-1)).toBeNull();
    expect(rows.some((row) => row.kind === "tool")).toBe(true);
    expect(
      rows.some((row) => row.kind === "system" && typeof row.content === "string" && row.content.includes("Thinking…")),
    ).toBe(false);
    expect(rows.some((row) => row.kind === "assistant" && row.content === "done")).toBe(true);
  });

  test("does not add generic tool rows when progress stream is empty", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
          toolCalls: ["run-command"],
        }),
        status: async () => ({}),
      }),
    });

    await handleMessage("hello");

    expect(rows.some((row) => row.kind === "tool")).toBe(false);
    expect(rows.some((row) => row.kind === "assistant" && row.content === "done")).toBe(true);
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

    expect(rows.some((row) => row.kind === "tool")).toBe(false);
    expect(rows.some((row) => row.kind === "assistant" && row.content === "No matches found.")).toBe(true);
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
    let calls = 0;
    const {
      handleMessage,
      rows,
      calls: spies,
    } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        reply: async () => {
          calls += 1;
          if (calls === 1) throw new Error("Remote server stream timed out after 120000ms");
          return { model: "gpt-5-mini", output: "ok" };
        },
      }),
    });

    await handleMessage("first");
    await handleMessage("second");

    expect(calls).toBe(2);
    expect(spies.thinkingTransitions).toEqual([true, false, true, false]);
    expect(
      rows.some(
        (row) =>
          row.kind === "system" && typeof row.content === "string" && row.content.includes("Server request timed out"),
      ),
    ).toBe(true);
    expect(rows.some((row) => row.kind === "assistant" && row.content === "ok")).toBe(true);
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
    expect(calls.thinkingTransitions).toEqual([true]);
    expect(calls.progressTexts).toContain("Still running on server…");
    await Bun.sleep(800);
    expect(calls.thinkingTransitions).toEqual([true, false]);
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
          { type: "tool-call", toolCallId: "call_1", toolName: "read-file", args: { paths: [{ path: "a.ts" }] } },
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "read-file",
            isError: true,
            errorCode: "E_GUARD_BLOCKED",
            error: { code: "E_GUARD_BLOCKED", category: "guard-blocked" },
          },
        ],
        reply: async () => ({
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
          { type: "tool-call", toolCallId: "call_blocked", toolName: "read-file", args: { paths: [{ path: "a.ts" }] } },
          {
            type: "tool-result",
            toolCallId: "call_blocked",
            toolName: "read-file",
            isError: true,
            errorCode: "E_GUARD_BLOCKED",
            error: { code: "E_GUARD_BLOCKED", category: "guard-blocked" },
          },
          { type: "tool-call", toolCallId: "call_ok", toolName: "edit-file", args: { path: "b.ts" } },
          {
            type: "tool-output",
            toolCallId: "call_ok",
            toolName: "edit-file",
            content: { kind: "tool-header", label: "Edit", detail: "b.ts" },
          },
          {
            type: "tool-output",
            toolCallId: "call_ok",
            toolName: "edit-file",
            content: { kind: "diff", lineNumber: 2, marker: "add", text: "export const b = 2;" },
          },
        ],
        reply: async () => ({
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
        toolRows[0]?.content.parts.some((item) => item.kind === "tool-header" && item.label === "Edit"),
    ).toBe(true);
    expect(
      rows.some((row) => isToolOutput(row.content) && row.content.parts.some((item) => item.kind === "file-header")),
    ).toBe(false);
  });

  test("does not merge tool rows across separate user turns", async () => {
    const replies = [
      { model: "gpt-5-mini", output: "first done" },
      { model: "gpt-5-mini", output: "second done" },
    ];
    const eventsByTurn: StreamEvent[][] = [
      [
        { type: "tool-call", toolCallId: "call_1", toolName: "edit-file", args: { path: "sum.rs" } },
        {
          type: "tool-output",
          toolCallId: "call_1",
          toolName: "edit-file",
          content: { kind: "tool-header", label: "Edit", detail: "sum.rs" },
        },
        {
          type: "tool-output",
          toolCallId: "call_1",
          toolName: "edit-file",
          content: { kind: "diff", lineNumber: 1, marker: "add", text: "fn main() {}" },
        },
      ],
      [
        { type: "tool-call", toolCallId: "call_2", toolName: "edit-file", args: { path: "sum.rs" } },
        {
          type: "tool-output",
          toolCallId: "call_2",
          toolName: "edit-file",
          content: { kind: "tool-header", label: "Edit", detail: "sum.rs" },
        },
        {
          type: "tool-output",
          toolCallId: "call_2",
          toolName: "edit-file",
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
          return replies[turn] ?? { model: "gpt-5-mini", output: "done" };
        },
      }),
    });

    await handleMessage("create file");
    await handleMessage("edit file");

    const editedRows = rows.filter(
      (row) =>
        row.kind === "tool" &&
        isToolOutput(row.content) &&
        row.content.parts.some((item) => item.kind === "tool-header" && item.label === "Edit"),
    );
    expect(editedRows).toHaveLength(2);
  });

  test("persists token usage on successful turn", async () => {
    const { handleMessage, session, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        reply: async () => ({
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
});
