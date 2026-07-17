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
    const { handleMessage, allRows, calls } = createMessageHandlerHarness({
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
    const [userRow, systemRow] = allRows;
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
    const { handleMessage, allRows, calls } = createMessageHandlerHarness();

    await handleMessage("/sessions");

    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
    const [userRow, systemRow] = allRows;
    expect(userRow?.kind).toBe("user");
    expect(userRow?.content).toBe("/sessions");
    expect(systemRow?.kind).toBe("system");
    expect(isCommandOutput(systemRow?.content) && systemRow?.content.header).toBe("Sessions 1");
  });

  test("routes /usage through message handler and renders usage output row", async () => {
    const { handleMessage, allRows, calls } = createMessageHandlerHarness();

    await handleMessage("/usage");

    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
    const [userRow, systemRow] = allRows;
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
          return { model: input.request.model, outputStreamed: false, output: "ok" };
        },
      }),
    });

    await handleMessage("hello");

    expect(requestedModel).toBe("claude-opus-4-6");
  });

  test("keeps create-edit-delete tool output visible across submits", async () => {
    const replies = [
      { model: "gpt-5-mini", outputStreamed: true, output: "Created sum.rs." },
      {
        model: "gpt-5-mini",
        outputStreamed: true,
        output: "Updated sum.rs for three args.",
      },
      { model: "gpt-5-mini", outputStreamed: true, output: "Removed sum.rs." },
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
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (input) => {
          const turn = replyCount++;
          const events = eventsByTurn[turn] ?? [];
          for (const event of events) {
            input.onEvent(event);
          }
          return replies[turn] ?? { model: "gpt-5-mini", outputStreamed: false, output: "done" };
        },
      }),
    });

    await handleMessage("create a rust script that sums two numbers");
    await handleMessage("update sum.rs to take three instead of two");
    await handleMessage("delete sum.rs");

    // Each turn promotes its rows — collect all promoted rows across turns.
    const promoted = calls.promotedSnapshots.flat();
    const toolRows = promoted.filter((row) => row.kind === "tool");
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
    expect(promoted.some((row) => row.kind === "assistant" && row.content === "Created sum.rs.")).toBe(true);
    expect(promoted.some((row) => row.kind === "assistant" && row.content === "Updated sum.rs for three args.")).toBe(
      true,
    );
    expect(promoted.some((row) => row.kind === "assistant" && row.content === "Removed sum.rs.")).toBe(true);
  });

  test("keeps the streamed prose as the authoritative transcript", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (input) => {
          input.onEvent({ type: "text-delta", text: "the complete streamed answer." });
          return {
            model: "gpt-5-mini",
            outputStreamed: true,
            output: "the complete streamed answer.",
          };
        },
      }),
    });

    await handleMessage("tell me about this project");

    const assistantRows = calls.promotedSnapshots.flat().filter((row) => row.kind === "assistant");
    expect(assistantRows).toHaveLength(1);
    expect(assistantRows[0]?.content).toBe("the complete streamed answer.");
  });

  test("falls back to reply.output when the stream emits no prose", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async () => ({
          model: "gpt-5-mini",
          outputStreamed: false,
          output: "answer delivered without deltas.",
        }),
      }),
    });

    await handleMessage("tell me about this project");

    const assistantRows = calls.promotedSnapshots.flat().filter((row) => row.kind === "assistant");
    expect(assistantRows).toHaveLength(1);
    expect(assistantRows[0]?.content).toBe("answer delivered without deltas.");
  });

  test("clears running usage in the same commit as the token entry, before stop-pending", async () => {
    // Regression: the status line sums committed + running usage. If running
    // usage is cleared only in the finally (past `await persist()`) rather than
    // alongside the token commit, one render double-counts the finished turn.
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (input) => {
          input.onEvent({ type: "text-delta", text: "answer" });
          return { model: "gpt-5-mini", outputStreamed: true, output: "answer" };
        },
      }),
    });

    await handleMessage("hi");

    const tokenIdx = calls.order.indexOf("token-commit");
    const clearIdx = calls.order.indexOf("running-clear");
    const stopIdx = calls.order.indexOf("stop-pending");
    expect(tokenIdx).toBeGreaterThanOrEqual(0);
    expect(clearIdx).toBeGreaterThan(tokenIdx);
    expect(stopIdx).toBeGreaterThan(clearIdx);
    expect(calls.runningUsageSets.at(-1)).toBeNull();
  });

  test("completion turn: streamed answer is not duplicated by the authoritative commit", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (input) => {
          input.onEvent({ type: "text-delta", text: "The complete answer." });
          return {
            model: "gpt-5-mini",
            outputStreamed: true,
            output: "The complete answer.",
            toolCalls: [],
          };
        },
      }),
    });

    await handleMessage("say the complete answer");

    const assistantRows = calls.promotedSnapshots.flat().filter((row) => row.kind === "assistant");
    expect(assistantRows).toHaveLength(1);
    expect(assistantRows[0]?.content).toBe("The complete answer.");
  });

  test("preserves prose/tool interleaving instead of collapsing prose to the end", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (input) => {
          input.onEvent({ type: "text-delta", text: "Let me check the file." });
          input.onEvent({ type: "tool-call", toolCallId: "call_1", toolName: "file-edit", args: { path: "a.rs" } });
          input.onEvent({
            type: "tool-output",
            toolCallId: "call_1",
            toolName: "file-edit",
            content: { kind: "tool-header", labelKey: "tool.label.file_edit", detail: "a.rs" },
          });
          input.onEvent({ type: "text-delta", text: "Done editing." });
          return { model: "gpt-5-mini", outputStreamed: true, output: "Let me check the file.\nDone editing." };
        },
      }),
    });

    await handleMessage("edit a.rs");

    const promoted = calls.promotedSnapshots.flat();
    const kinds = promoted.map((row) => row.kind);
    const firstProse = kinds.indexOf("assistant");
    const toolIdx = kinds.indexOf("tool");
    const lastProse = kinds.lastIndexOf("assistant");
    // Prose that streamed before the tool call stays before it; a second prose row
    // follows. The old drop-and-recommit collapsed both into one bubble after the tool.
    expect(firstProse).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThan(firstProse);
    expect(lastProse).toBeGreaterThan(toolIdx);
    const proseContents = promoted.filter((row) => row.kind === "assistant").map((row) => row.content);
    expect(proseContents).toEqual(["Let me check the file.", "Done editing."]);
  });

  test("a skill activated mid-turn updates the session live", async () => {
    const { handleMessage, session } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (input) => {
          input.onEvent({ type: "skill-activated", skill: { name: "build", instructions: "slice it" } });
          return { model: "gpt-5-mini", outputStreamed: true, output: "on it" };
        },
      }),
    });

    await handleMessage("use the build skill");

    expect(session.activeSkills?.map((s) => s.name)).toEqual(["build"]);
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
      resumeTranscript: () => {},
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
          return { model: "gpt-5-mini", outputStreamed: true, output: "Second answer." };
        },
        status: async () => ({}),
      }),
      sessionState,
      currentSession: session,
      setCurrentSession: () => {},
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
      resumeTranscript: () => {},
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
    const { handleMessage, allRows } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (input) => {
          replyCalls += 1;
          input.onEvent({ type: "text-delta", text: "ok" });
          return { model: "gpt-5-mini", outputStreamed: true, output: "ok" };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("review @definitely-not-a-real-file-xyz");

    expect(replyCalls).toBe(1);
    expect(
      allRows.some((row) => typeof row.content === "string" && row.content.includes("No file or folder found")),
    ).toBe(true);
  });

  test("shows warning for unresolved @references alongside resolved ones", async () => {
    let replyCalls = 0;
    const fixture = `tmp-chat-handleMessage-${testUuid()}.txt`;
    const fixturePath = join(process.cwd(), fixture);
    await writeFile(fixturePath, "fixture");

    try {
      const { handleMessage, allRows } = createMessageHandlerHarness({
        client: createClient({
          replyStream: async (input) => {
            replyCalls += 1;
            input.onEvent({ type: "text-delta", text: "ok" });
            return { model: "gpt-5-mini", outputStreamed: true, output: "ok" };
          },
          status: async () => ({}),
        }),
      });

      await handleMessage(`review @${fixture} and @definitely-not-a-real-file-xyz`);

      expect(replyCalls).toBe(1);
      expect(
        allRows.some((row) => typeof row.content === "string" && row.content.includes("No file or folder found")),
      ).toBe(true);
      expect(allRows.some((row) => row.kind === "assistant" && row.content === "ok")).toBe(true);
    } finally {
      await rm(fixturePath, { force: true });
    }
  });

  test("concurrent handleSubmit calls only process one turn", async () => {
    let replyCount = 0;
    const { handleMessage, allRows, session } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (input) => {
          replyCount++;
          await Bun.sleep(10);
          input.onEvent({ type: "text-delta", text: "ok" });
          return { model: "gpt-5-mini", outputStreamed: true, output: "ok" };
        },
        status: async () => ({}),
      }),
    });

    const first = handleMessage("hello");
    const second = handleMessage("hello");
    await Promise.all([first, second]);

    expect(session.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(allRows.filter((r) => r.kind === "user")).toHaveLength(1);
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
      resumeTranscript: () => {},
      clearTranscript: () => {},
    });

    await handleSubmit("test remote");

    // Interrupt handler must still be registered so the user can Ctrl+C
    // to cancel the remote task polling.
    expect(interruptHandler).not.toBeNull();
  });

  test("promote is called after turn completion with all rows", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (input) => {
          input.onEvent({ type: "text-delta", text: "done" });
          return { model: "gpt-5-mini", outputStreamed: true, output: "done" };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("hello");

    const promoted = calls.promotedSnapshots.flat();
    expect(promoted.some((r) => r.kind === "user")).toBe(true);
    expect(promoted.some((r) => r.kind === "assistant")).toBe(true);
  });

  test("promote includes tool output rows", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (input) => {
          input.onEvent({ type: "tool-call", toolCallId: "tc_1", toolName: "file-edit", args: {} });
          input.onEvent({
            type: "tool-output",
            toolCallId: "tc_1",
            toolName: "file-edit",
            content: { kind: "tool-header", labelKey: "tool.label.file_edit", detail: "test.ts" },
          });
          input.onEvent({ type: "text-delta", text: "edited" });
          return { model: "gpt-5-mini", outputStreamed: true, output: "edited" };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("edit a file");

    const promoted = calls.promotedSnapshots.flat();
    expect(promoted.some((r) => r.kind === "tool")).toBe(true);
  });

  test("renders assistant output even when the reply streams no deltas", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async () => ({
          model: "gpt-5-mini",
          outputStreamed: false,
          output: "No changes needed.",
        }),
        status: async () => ({}),
      }),
    });

    await handleMessage("hello");

    const promoted = calls.promotedSnapshots[0] ?? [];
    expect(promoted.some((r) => r.kind === "assistant" && r.content === "No changes needed.")).toBe(true);
  });

  test("eagerly promotes finalized rows mid-turn, before the turn completes", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (input) => {
          input.onEvent({ type: "text-delta", text: "Checking the file." });
          input.onEvent({ type: "tool-call", toolCallId: "c1", toolName: "file-edit", args: { path: "a.rs" } });
          input.onEvent({
            type: "tool-output",
            toolCallId: "c1",
            toolName: "file-edit",
            content: { kind: "tool-header", labelKey: "tool.label.file_edit", detail: "a.rs" },
          });
          input.onEvent({ type: "tool-result", toolCallId: "c1", toolName: "file-edit" });
          input.onEvent({ type: "text-delta", text: "Done." });
          return { model: "gpt-5-mini", outputStreamed: true, output: "Checking the file.\nDone." };
        },
      }),
    });

    await handleMessage("edit a.rs");

    // Promotion happens incrementally: the first prose row and the resolved tool row
    // move to scrollback while the turn is still streaming, not in one turn-end batch.
    expect(calls.promotedSnapshots.length).toBeGreaterThan(1);
    const firstBatch = calls.promotedSnapshots[0] ?? [];
    expect(firstBatch.some((r) => r.kind === "assistant" && r.content === "Checking the file.")).toBe(true);
    // Every row still lands in scrollback exactly once across the incremental batches.
    const promoted = calls.promotedSnapshots.flat();
    const proseContents = promoted.filter((r) => r.kind === "assistant").map((r) => r.content);
    expect(proseContents).toEqual(["Checking the file.", "Done."]);
    expect(promoted.filter((r) => r.kind === "tool")).toHaveLength(1);
    const ids = promoted.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("de-duplicates a repeated progress notice even after it is promoted", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (input) => {
          input.onEvent({ type: "error", errorMessage: "rate limited, retrying" });
          input.onEvent({ type: "error", errorMessage: "rate limited, retrying" });
          input.onEvent({ type: "text-delta", text: "ok" });
          return { model: "gpt-5-mini", outputStreamed: true, output: "ok" };
        },
      }),
    });

    await handleMessage("go");

    const notices = calls.promotedSnapshots
      .flat()
      .filter((r) => r.kind === "system" && r.content === "rate limited, retrying");
    expect(notices).toHaveLength(1);
  });

  test("promote clears dynamic rows", async () => {
    const { handleMessage, rows, calls } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (input) => {
          input.onEvent({ type: "text-delta", text: "done" });
          return { model: "gpt-5-mini", outputStreamed: true, output: "done" };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("hello");

    expect(calls.promotedSnapshots).toHaveLength(1);
    expect(rows).toHaveLength(0);
  });

  test("a blocked question promotes the reason into the durable transcript", async () => {
    const { handleMessage, rows, session, calls } = createMessageHandlerHarness({
      client: createClient({
        // A blocked turn with no streamed prose: the reason arrives via output, nothing streams.
        replyStream: async () => ({
          model: "gpt-5-mini",
          outputStreamed: false,
          output: "Which credential should I use?",
        }),
        status: async () => ({}),
      }),
    });

    await handleMessage("set up the deploy");

    expect(calls.promotedSnapshots).toHaveLength(1);
    const promoted = calls.promotedSnapshots[0] ?? [];
    expect(promoted.some((r) => r.kind === "assistant" && r.content === "Which credential should I use?")).toBe(true);
    expect(rows).toHaveLength(0);
    expect(session.messages.some((m) => m.role === "assistant" && m.content === "Which credential should I use?")).toBe(
      true,
    );
  });

  test("a blocking error renders as an error row with no prompt or invented prose", async () => {
    const { handleMessage, session, calls } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async () => ({
          model: "gpt-5-mini",
          outputStreamed: false,
          output: "",
          error: "completion blocked: empty answer",
        }),
        status: async () => ({}),
      }),
    });

    await handleMessage("do the thing");

    expect(calls.promotedSnapshots).toHaveLength(1);
    const promoted = calls.promotedSnapshots[0] ?? [];
    expect(promoted.some((r) => r.kind === "system" && r.content === "completion blocked: empty answer")).toBe(true);
    expect(promoted.some((r) => r.kind === "assistant")).toBe(false);
    expect(session.messages.some((m) => m.role === "assistant")).toBe(false);
    expect(calls.pendingStates.at(-1)).toBeNull();
    expect(calls.pendingTransitions.at(-1)).toBe(false);
  });

  test("a blocked question after tool calls still renders its reason", async () => {
    const reason = "Which layer should the rate limit live in — the RPC accept loop or per-session?";
    const { handleMessage, session, calls } = createMessageHandlerHarness({
      client: createClient({
        // Mirrors a real blocked turn: the model runs tools, streams NO prose, then ends its
        // turn with the reason as output only, never as a text-delta.
        replyStream: async (input) => {
          input.onEvent({ type: "text-delta", text: "\n" });
          input.onEvent({ type: "reasoning", text: "Considering where the limit belongs." });
          input.onEvent({
            type: "tool-call",
            toolCallId: "c1",
            toolName: "file-read",
            args: { path: "src/server.ts" },
          });
          input.onEvent({
            type: "tool-output",
            toolCallId: "c1",
            toolName: "file-read",
            content: { kind: "tool-header", labelKey: "tool.file_read.header", detail: "src/server.ts" },
          });
          input.onEvent({ type: "tool-result", toolCallId: "c1", toolName: "file-read" });
          input.onEvent({ type: "text-delta", text: "\n" });
          return { model: "gpt-5-mini", outputStreamed: false, output: reason };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("Add rate limiting to the RPC server.");

    const promoted = calls.promotedSnapshots.flat();
    expect(promoted.some((r) => r.kind === "assistant" && r.content === reason)).toBe(true);
    expect(session.messages.some((m) => m.role === "assistant" && m.content === reason)).toBe(true);
  });

  test("a blocked reason renders even when narration prose streamed first", async () => {
    // F7: the model streams a preamble (a real prose row), runs tools, then blocks with the
    // answer delivered only via output (never as deltas). Earlier narration must not be
    // mistaken for the answer and suppress rendering the blocked reason.
    const narration = "I'm going to locate the RPC server and add rate limiting.";
    const reason = "Which layer should the rate limit live in — the RPC accept loop or per-session?";
    const { handleMessage, session, calls } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (input) => {
          input.onEvent({ type: "text-delta", text: narration });
          input.onEvent({
            type: "tool-call",
            toolCallId: "c1",
            toolName: "file-read",
            args: { path: "src/server.ts" },
          });
          input.onEvent({
            type: "tool-output",
            toolCallId: "c1",
            toolName: "file-read",
            content: { kind: "tool-header", labelKey: "tool.file_read.header", detail: "src/server.ts" },
          });
          input.onEvent({ type: "tool-result", toolCallId: "c1", toolName: "file-read" });
          return { model: "gpt-5-mini", outputStreamed: false, output: reason };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("Add rate limiting to the RPC server.");

    const promoted = calls.promotedSnapshots.flat();
    expect(promoted.some((r) => r.kind === "assistant" && r.content === narration)).toBe(true);
    expect(promoted.some((r) => r.kind === "assistant" && r.content === reason)).toBe(true);
    expect(session.messages.some((m) => m.role === "assistant" && m.content === reason)).toBe(true);
  });

  test("answering a blocked turn in-process does not duplicate the reason row", async () => {
    let call = 0;
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async () => {
          call += 1;
          return call === 1
            ? { model: "gpt-5-mini", outputStreamed: false, output: "Which credential should I use?" }
            : { model: "gpt-5-mini", outputStreamed: false, output: "Deployed." };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("set up the deploy");
    await handleMessage("use the CI token");

    const promoted = calls.promotedSnapshots.flat();
    expect(
      promoted.filter((r) => r.kind === "assistant" && r.content === "Which credential should I use?"),
    ).toHaveLength(1);
  });

  test("promote is called after abort with interrupted row", async () => {
    const rows: ChatRow[] = [];
    let interruptHandler: () => void = () => {};
    let interruptRegistered = false;
    const promotedSnapshots: ChatRow[][] = [];

    const session = createSession({ id: "sess_test" });
    const sessionState = createSessionState({ activeSessionId: session.id, sessions: [session] });

    const { handleSubmit } = createMessageHandler({
      client: createClient({
        replyStream: async (input) =>
          new Promise((_, reject) => {
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
      promote: () => {
        promotedSnapshots.push([...rows]);
        rows.splice(0, rows.length);
      },
      resumeTranscript: () => {},
      clearTranscript: () => {},
    });

    const pending = handleSubmit("hello");
    for (let i = 0; i < 20 && !interruptRegistered; i++) {
      await Bun.sleep(1);
    }
    interruptHandler();
    await pending;

    expect(promotedSnapshots).toHaveLength(1);
    const promoted = promotedSnapshots[0] ?? [];
    expect(promoted.some((r) => r.kind === "task" && r.content === "Interrupted")).toBe(true);
  });

  test("a blocked question ends the turn with no pending indicator", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({
      client: createClient({
        replyStream: async (input) => {
          input.onEvent({ type: "text-delta", text: "What input?" });
          return { model: "gpt-5-mini", outputStreamed: false, output: "What input?" };
        },
        status: async () => ({}),
      }),
    });

    await handleMessage("ask me for some input");

    expect(calls.pendingStates.at(-1)).toBeNull();
    expect(calls.pendingTransitions.at(-1)).toBe(false);
  });
});
