import { describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatRow } from "./chat-contract";
import { isCommandOutput, isToolOutput } from "./chat-contract";
import { createMessageHandler } from "./chat-message-handler";
import { resolveNaturalRememberDirective } from "./chat-message-handler-helpers";
import type { StreamEvent } from "./client-contract";
import { palette } from "./palette";
import {
  createClient,
  createMessage,
  createMessageHandlerHarness,
  createSession,
  createSessionState,
  testUuid,
} from "./test-utils";

describe("chat message handler", () => {
  test("resolveNaturalRememberDirective parses user and project forms", () => {
    expect(resolveNaturalRememberDirective("remember this: keep output concise")).toEqual({
      scope: "user",
      content: "keep output concise",
    });
    expect(resolveNaturalRememberDirective("remember this for user: prefer numbered lists")).toEqual({
      scope: "user",
      content: "prefer numbered lists",
    });
    expect(resolveNaturalRememberDirective("remember this for project: use bun scripts")).toEqual({
      scope: "project",
      content: "use bun scripts",
    });
    expect(
      resolveNaturalRememberDirective("no need, only big features should be documented there, remember this"),
    ).toEqual({
      scope: "user",
      content: "no need, only big features should be documented there",
    });
    expect(
      resolveNaturalRememberDirective("only big features should be documented, remember this for project"),
    ).toEqual({
      scope: "project",
      content: "only big features should be documented",
    });
    expect(resolveNaturalRememberDirective("remember prefer concise output")).toEqual({
      scope: "user",
      content: "prefer concise output",
    });
    expect(resolveNaturalRememberDirective("prefer concise output remember")).toEqual({
      scope: "user",
      content: "prefer concise output",
    });
    expect(resolveNaturalRememberDirective("remember this")).toBeNull();
  });

  test("ignores empty input", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness();
    await handleMessage("   ");
    expect(calls.setInputHistory).toBe(0);
    expect(calls.setValue).toEqual([]);
    expect(calls.setShowHelp).toEqual([]);
  });

  test("ignores input while thinking", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({ isPending: true });
    await handleMessage("hello");
    expect(calls.setInputHistory).toBe(0);
    expect(calls.setValue).toEqual([]);
  });

  test("handles slash command while thinking", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({ isPending: true });
    await handleMessage("/sessions");
    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
  });

  test("ignores unknown single-token slash commands", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness();
    await handleMessage("/not-a-command");
    expect(calls.setInputHistory).toBe(0);
    expect(calls.setValue).toEqual([]);
  });

  test("routes /status through message handler and renders status output row", async () => {
    const { handleMessage, rows, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({
          providers: ["openai"],
          model: "gpt-5-mini",
        }),
      }),
    });

    await handleMessage("/status");

    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
    const [userRow, systemRow] = rows;
    expect(userRow?.kind).toBe("user");
    expect(userRow?.content).toBe("/status");
    expect(systemRow?.kind).toBe("system");
    const statusContent = systemRow?.content as { header: string; sections: [string, string][][] };
    expect(statusContent?.header).toBe("Status");
    const pairs = statusContent?.sections[0] ?? [];
    expect(pairs).toContainEqual(["Providers", "openai"]);
    expect(pairs).toContainEqual(["Model", "gpt-5-mini"]);
  });

  test("routes /sessions through message handler and renders sessions list row", async () => {
    const { handleMessage, rows, calls } = createMessageHandlerHarness();

    await handleMessage("/sessions");

    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
    const [userRow, systemRow] = rows;
    expect(userRow?.kind).toBe("user");
    expect(userRow?.content).toBe("/sessions");
    expect(systemRow?.kind).toBe("system");
    expect(isCommandOutput(systemRow?.content) && systemRow?.content.header).toBe("Sessions 1");
  });

  test("routes /usage through message handler and renders usage output row", async () => {
    const { handleMessage, rows, calls } = createMessageHandlerHarness();

    await handleMessage("/usage");

    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
    const [userRow, systemRow] = rows;
    expect(userRow?.kind).toBe("user");
    expect(userRow?.content).toBe("/usage");
    expect(systemRow?.kind).toBe("system");
    expect(systemRow?.content).toBe("No usage data yet. Send a prompt first.");
  });

  test("uses current session model for assistant turn requests", async () => {
    const session = createSession({ id: "sess_test", model: "claude-opus-4-6" });
    let requestedModel = "";
    const { handleMessage } = createMessageHandlerHarness({
      session,
      client: createClient({
        replyStream: async (input) => {
          requestedModel = input.request.model;
          return { state: "done" as const, model: input.request.model, output: "ok" };
        },
      }),
    });

    await handleMessage("hello");

    expect(requestedModel).toBe("claude-opus-4-6");
  });

  test("keeps create-edit-delete tool output visible across submits", async () => {
    const replies = [
      { state: "done" as const, model: "gpt-5-mini", output: "Created sum.rs." },
      {
        state: "done" as const,
        model: "gpt-5-mini",
        output: "Updated sum.rs for three args.",
      },
      { state: "done" as const, model: "gpt-5-mini", output: "Removed sum.rs." },
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
        { type: "text-delta", text: "Created sum.rs." },
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
          content: { kind: "diff", lineNumber: 2, marker: "remove", text: "let sum = a + b;" },
        },
        {
          type: "tool-output",
          toolCallId: "call_2",
          toolName: "file-edit",
          content: { kind: "diff", lineNumber: 2, marker: "add", text: "let sum = a + b + c;" },
        },
        { type: "text-delta", text: "Updated sum.rs for three args." },
      ],
      [
        { type: "tool-call", toolCallId: "call_3", toolName: "file-delete", args: { path: "sum.rs" } },
        {
          type: "tool-output",
          toolCallId: "call_3",
          toolName: "file-delete",
          content: { kind: "tool-header", labelKey: "tool.label.file_delete", detail: "sum.rs" },
        },
        { type: "text-delta", text: "Removed sum.rs." },
      ],
    ];
    let replyCount = 0;
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (input) => {
          const turn = replyCount++;
          const events = eventsByTurn[turn] ?? [];
          for (const event of events) {
            input.onEvent(event);
          }
          return replies[turn] ?? { state: "done" as const, model: "gpt-5-mini", output: "done" };
        },
      }),
    });

    await handleMessage("create a rust script that sums two numbers");
    await handleMessage("update sum.rs to take three instead of two");
    await handleMessage("delete sum.rs");

    const toolRows = rows.filter((row) => row.kind === "tool");
    expect(toolRows).toHaveLength(3);
    expect(
      isToolOutput(toolRows[0]?.content) &&
        toolRows[0]?.content.parts.some((i) => i.kind === "tool-header" && i.labelKey === "tool.label.file_edit"),
    ).toBe(true);
    expect(
      isToolOutput(toolRows[1]?.content) &&
        toolRows[1]?.content.parts.some((i) => i.kind === "tool-header" && i.labelKey === "tool.label.file_edit"),
    ).toBe(true);
    expect(
      isToolOutput(toolRows[1]?.content) &&
        toolRows[1]?.content.parts.some((i) => i.kind === "diff" && i.text === "let sum = a + b + c;"),
    ).toBe(true);
    expect(
      isToolOutput(toolRows[2]?.content) &&
        toolRows[2]?.content.parts.some((i) => i.kind === "tool-header" && i.labelKey === "tool.label.file_delete"),
    ).toBe(true);
    // Assistant text rows are kept as-is (no redundancy filtering).
    expect(rows.some((row) => row.kind === "assistant" && row.content === "Created sum.rs.")).toBe(true);
    expect(rows.some((row) => row.kind === "assistant" && row.content === "Updated sum.rs for three args.")).toBe(true);
    expect(rows.some((row) => row.kind === "assistant" && row.content === "Removed sum.rs.")).toBe(true);
  });

  test("toggles shortcuts on ? input", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness();
    await handleMessage("?");
    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
    expect(calls.setShowHelp).toHaveLength(1);
    expect(typeof calls.setShowHelp[0]).toBe("function");
  });

  test("records interrupted row when active turn is aborted", async () => {
    const rows: ChatRow[] = [];
    let interruptHandler: () => void = () => {};
    let interruptRegistered = false;

    const session = createSession({ id: "sess_test" });
    const sessionState = createSessionState({ activeSessionId: session.id, sessions: [session] });

    const { handleSubmit } = createMessageHandler({
      client: createClient({
        replyStream: async (input) =>
          await new Promise((_, reject) => {
            const abort = (): void => {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            };
            if (input.signal?.aborted) {
              abort();
              return;
            }
            input.signal?.addEventListener("abort", abort, { once: true });
          }),
        status: async () => ({}),
      }),
      sessionState,
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
      openModelPanel: () => {},
      tokenUsage: [],
      isPending: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      onStartPending: () => {},
      onStopPending: () => {},
      setPendingState: () => {},
      setRunningUsage: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: (handler) => {
        interruptRegistered = handler !== null;
        if (handler) interruptHandler = handler;
      },
      clearTranscript: () => {},
    });

    const pending = handleSubmit("hello");
    for (let i = 0; i < 20 && !interruptRegistered; i++) {
      await Bun.sleep(1);
    }
    expect(interruptRegistered).toBe(true);
    interruptHandler();
    await pending;

    const last = rows[rows.length - 1];
    expect(last?.kind).toBe("task");
    expect(last?.content).toBe("Interrupted");
    expect(last?.style?.dim).toBe(true);
    expect(last?.style?.marker).toBe(palette.cancelled);
  });

  test("interrupt followed by next prompt yields clean transcript flow", async () => {
    const rows: ChatRow[] = [];
    let interruptHandler: () => void = () => {};
    let interruptRegistered = false;
    let callCount = 0;

    const session = createSession({ id: "sess_test" });
    const sessionState = createSessionState({ activeSessionId: session.id, sessions: [session] });

    const { handleSubmit } = createMessageHandler({
      client: createClient({
        replyStream: async (input) => {
          const call = callCount++;
          if (call === 0) {
            return await new Promise((_, reject) => {
              const abort = (): void => {
                const error = new Error("Aborted");
                error.name = "AbortError";
                reject(error);
              };
              if (input.signal?.aborted) {
                abort();
                return;
              }
              input.signal?.addEventListener("abort", abort, { once: true });
            });
          }
          input.onEvent({ type: "text-delta", text: "Second answer." });
          return { state: "done" as const, model: "gpt-5-mini", output: "Second answer." };
        },
        status: async () => ({}),
      }),
      sessionState,
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
      openModelPanel: () => {},
      tokenUsage: [],
      isPending: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      onStartPending: () => {},
      onStopPending: () => {},
      setPendingState: () => {},
      setRunningUsage: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: (handler) => {
        interruptRegistered = handler !== null;
        if (handler) interruptHandler = handler;
      },
      clearTranscript: () => {},
    });

    const firstPending = handleSubmit("First question");
    for (let i = 0; i < 20 && !interruptRegistered; i++) {
      await Bun.sleep(1);
    }
    expect(interruptRegistered).toBe(true);
    interruptHandler();
    await firstPending;

    // The interrupted user message should be removed from session history
    // so the model doesn't try to answer it on the next turn.
    const historyBeforeSecond = session.messages.map((m) => `${m.role}:${m.content}`);
    expect(historyBeforeSecond).not.toContainEqual("user:First question");

    await handleSubmit("Second question");

    expect(rows.map((row) => `${row.kind}:${row.content}`)).toEqual([
      "user:First question",
      "task:Interrupted",
      "user:Second question",
      "assistant:Second answer.",
    ]);
  });

  test("shows warning for unresolved @references but continues turn", async () => {
    let replyCalls = 0;
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (input) => {
          replyCalls += 1;
          input.onEvent({ type: "text-delta", text: "ok" });
          return { state: "done" as const, model: "gpt-5-mini", output: "ok" };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("review @definitely-not-a-real-file-xyz");

    expect(replyCalls).toBe(1);
    expect(rows.some((row) => typeof row.content === "string" && row.content.includes("No file or folder found"))).toBe(
      true,
    );
  });

  test("shows warning for unresolved @references alongside resolved ones", async () => {
    let replyCalls = 0;
    const fixture = `tmp-chat-handleMessage-${testUuid()}.txt`;
    const fixturePath = join(process.cwd(), fixture);
    await writeFile(fixturePath, "fixture");

    try {
      const { handleMessage, rows } = createMessageHandlerHarness({
        client: createClient({
          replyStream: async (input) => {
            replyCalls += 1;
            input.onEvent({ type: "text-delta", text: "ok" });
            return { state: "done" as const, model: "gpt-5-mini", output: "ok" };
          },
          status: async () => ({}),
        }),
      });

      await handleMessage(`review @${fixture} and @definitely-not-a-real-file-xyz`);

      expect(replyCalls).toBe(1);
      expect(
        rows.some((row) => typeof row.content === "string" && row.content.includes("No file or folder found")),
      ).toBe(true);
      expect(rows.some((row) => row.kind === "assistant" && row.content === "ok")).toBe(true);
    } finally {
      await rm(fixturePath, { force: true });
    }
  });

  test("concurrent handleSubmit calls only process one turn", async () => {
    let replyCount = 0;
    const { handleMessage, rows, session } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (input) => {
          replyCount++;
          await Bun.sleep(10);
          input.onEvent({ type: "text-delta", text: "ok" });
          return { state: "done" as const, model: "gpt-5-mini", output: "ok" };
        },
        status: async () => ({}),
      }),
    });

    const first = handleMessage("hello");
    const second = handleMessage("hello");
    await Promise.all([first, second]);

    expect(session.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "user")).toHaveLength(1);
    expect(replyCount).toBe(1);
  });

  test("interrupt handler stays registered during remote task followup", async () => {
    let interruptHandler: (() => void) | null = null;
    const session = createSession({ id: "sess_test" });
    const sessionState = createSessionState({ activeSessionId: session.id, sessions: [session] });

    const { handleSubmit } = createMessageHandler({
      client: createClient({
        replyStream: async () => {
          const error = new Error("Remote task") as Error & { taskId: string };
          error.taskId = "task_abc";
          throw error;
        },
        taskStatus: async () => ({
          id: "task_abc",
          state: "running" as const,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        }),
      }),
      sessionState,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        updater([]);
      },
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
      onStartPending: () => {},
      onStopPending: () => {},
      setPendingState: () => {},
      setRunningUsage: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: (handler) => {
        interruptHandler = handler;
      },
      clearTranscript: () => {},
    });

    await handleSubmit("test remote");

    // Interrupt handler must still be registered so the user can Ctrl+C
    // to cancel the remote task polling.
    expect(interruptHandler).not.toBeNull();
  });

  test("awaiting-input preserves pending state after turn completes", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (input) => {
          input.onEvent({ type: "text-delta", text: "What input?" });
          return { state: "awaiting-input" as const, model: "gpt-5-mini", output: "What input?" };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("ask me for some input");

    const last = calls.pendingStates[calls.pendingStates.length - 1];
    expect(last).toEqual({ kind: "awaiting-input" });
    expect(calls.pendingTransitions.at(-1)).toBe(true);
  });
});
