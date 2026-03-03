import { describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatRow } from "./chat-commands";
import { createMessageHandler } from "./chat-message-handler";
import { buildInternalWriteResumeTurn, resolveNaturalRememberDirective } from "./chat-message-handler-helpers";
import type { StreamEvent } from "./client";
import {
  createClient,
  createMessage,
  createMessageHandlerHarness,
  createSession,
  createStore,
  dedent,
} from "./test-utils";

describe("chat message handler guards", () => {
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
    const { handleMessage, calls } = createMessageHandlerHarness({ isWorking: true });
    await handleMessage("hello");
    expect(calls.setInputHistory).toBe(0);
    expect(calls.setValue).toEqual([]);
  });

  test("handles slash command while thinking", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness({ isWorking: true });
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
          provider: "openai",
          model: "gpt-5-mini",
          permissions: "write",
        }),
      }),
    });

    await handleMessage("/status");

    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
    const rendered = rows
      .map((row) => `${row.role} ${row.style ?? "none"}\n${row.content}`)
      .join("\n\n")
      .replace(/:\s+/g, ": ");
    expect(rendered).toBe(
      dedent(`
      user none
      /status

      system statusOutput
      provider: openai
      model: gpt-5-mini
      permissions: write
    `),
    );
  });

  test("routes /sessions through message handler and renders sessions list row", async () => {
    const { handleMessage, rows, calls } = createMessageHandlerHarness();

    await handleMessage("/sessions");

    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
    const rendered = rows
      .map((row) => `${row.role} ${row.style ?? "none"}\n${row.content}`)
      .join("\n\n")
      .replace(/(\s{2})(?:in moments|\d+[smhdw] ago)$/gm, "$1<relative>");
    expect(rendered).toBe(
      dedent(`
      user none
      /sessions

      system sessionsList
      Sessions 1

      ● sess_test  New Session  <relative>
    `),
    );
  });

  test("routes /tokens through message handler and renders token output row", async () => {
    const { handleMessage, rows, calls } = createMessageHandlerHarness();

    await handleMessage("/tokens");

    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
    const rendered = rows.map((row) => `${row.role} ${row.style ?? "none"}\n${row.content}`).join("\n\n");
    expect(rendered).toBe(
      dedent(`
      user none
      /tokens

      system tokenOutput
      No token data yet. Send a prompt first.
    `),
    );
  });

  test("keeps create-edit-delete tool output visible across submits", async () => {
    const replies = [
      { model: "gpt-5-mini", output: "Created sum.rs." },
      {
        model: "gpt-5-mini",
        output: "Updated sum.rs for three args.",
      },
      { model: "gpt-5-mini", output: "Removed sum.rs." },
    ];
    const eventsByTurn: StreamEvent[][] = [
      [{ type: "tool-call", toolCallId: "call_1", toolName: "edit-file", args: { path: "sum.rs" } }],
      [
        { type: "tool-call", toolCallId: "call_2", toolName: "edit-file", args: { path: "sum.rs" } },
        { type: "tool-output", toolCallId: "call_2", toolName: "edit-file", content: "2 - let sum = a + b;" },
        { type: "tool-output", toolCallId: "call_2", toolName: "edit-file", content: "2 + let sum = a + b + c;" },
      ],
      [{ type: "tool-call", toolCallId: "call_3", toolName: "delete-file", args: { path: "sum.rs" } }],
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

    await handleMessage("create a rust script that sums two numbers");
    await handleMessage("update sum.rs to take three instead of two");
    await handleMessage("delete sum.rs");

    const toolRows = rows.filter((row) => row.role === "assistant" && row.style === "toolProgress");
    expect(toolRows.map((row) => row.content)).toEqual([
      "Edit sum.rs",
      "Edit sum.rs\n2 - let sum = a + b;\n2 + let sum = a + b + c;",
      "Delete sum.rs",
    ]);
    // "Created sum.rs." and "Removed sum.rs." are redundant with their tool headers and get filtered.
    expect(rows.some((row) => row.role === "assistant" && row.content === "Created sum.rs.")).toBe(false);
    expect(rows.some((row) => row.role === "assistant" && row.content === "Updated sum.rs for three args.")).toBe(true);
    expect(rows.some((row) => row.role === "assistant" && row.content === "Removed sum.rs.")).toBe(false);
  });

  test("merges discovery/read file count into tool header", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          options.onEvent({
            type: "tool-call",
            toolCallId: "call_find",
            toolName: "find-files",
            args: { patterns: ["*.ts"] },
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_find",
            toolName: "find-files",
            content: "scope=workspace patterns=[*.ts] matches=3",
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_find",
            toolName: "find-files",
            content: "  src/a.ts",
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_find",
            toolName: "find-files",
            content: "  src/b.ts",
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_find",
            toolName: "find-files",
            content: "  src/c.ts",
          });
          return { model: "gpt-5-mini", output: "Done." };
        },
      }),
    });

    await handleMessage("find all ts files");

    const toolRow = rows.find(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.toolName === "find-files",
    );
    expect(toolRow?.content).toBe("Find *.ts\nsrc/a.ts\nsrc/b.ts\nsrc/c.ts");
  });

  test("merges search summary with pattern context into header", async () => {
    const { handleMessage, rows } = createMessageHandlerHarness({
      client: createClient({
        status: async () => ({}),
        replyStream: async (_input, options) => {
          options.onEvent({
            type: "tool-call",
            toolCallId: "call_search",
            toolName: "search-files",
            args: { pattern: "\\btool\\b" },
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_search",
            toolName: "search-files",
            content: "scope=paths:2 patterns=[tool] matches=2",
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_search",
            toolName: "search-files",
            content: "  src/a.ts \\btool\\b",
          });
          options.onEvent({
            type: "tool-output",
            toolCallId: "call_search",
            toolName: "search-files",
            content: "  src/b.ts \\btool\\b",
          });
          return { model: "gpt-5-mini", output: "Done." };
        },
      }),
    });

    await handleMessage("search tool pattern");

    const toolRow = rows.find(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.toolName === "search-files",
    );
    expect(toolRow?.content).toBe("Search paths:2 [tool]\nsrc/a.ts \\btool\\b\nsrc/b.ts \\btool\\b");
  });

  test("toggles shortcuts on ? input", async () => {
    const { handleMessage, calls } = createMessageHandlerHarness();
    await handleMessage("?");
    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
    expect(calls.setShowHelp).toHaveLength(1);
    expect(typeof calls.setShowHelp[0]).toBe("function");
  });

  test("opens write confirm panel for likely write prompt in read mode", async () => {
    let openWriteConfirmWith = "";
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const handleMessage = createMessageHandler({
      client: createClient({
        status: async () => ({ permissions: "read" }),
        reply: async () => ({ model: "gpt-5-mini", output: "ok" }),
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
      openWriteConfirmPanel: (prompt) => {
        openWriteConfirmWith = prompt;
      },
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

    await handleMessage("edit src/cli.ts to rename x to y");
    expect(openWriteConfirmWith).toBe("edit src/cli.ts to rename x to y");
  });

  test("opens write confirm panel for add/fix phrasing in read mode", async () => {
    let openWriteConfirmWith = "";
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const handleMessage = createMessageHandler({
      client: createClient({
        status: async () => ({ permissions: "read" }),
        reply: async () => ({ model: "gpt-5-mini", output: "ok" }),
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
      openWriteConfirmPanel: (prompt) => {
        openWriteConfirmWith = prompt;
      },
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

    await handleMessage("add a line break before the resume message");
    expect(openWriteConfirmWith).toBe("add a line break before the resume message");
  });

  test("internal write-resume payload bypasses read-mode write confirm gate", async () => {
    let openWriteConfirmWith = "";
    let replyCalls = 0;
    const rows: ChatRow[] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const handleMessage = createMessageHandler({
      client: createClient({
        status: async () => ({ permissions: "read" }),
        reply: async () => {
          replyCalls += 1;
          return { model: "gpt-5-mini", output: "done" };
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
      openWriteConfirmPanel: (prompt) => {
        openWriteConfirmWith = prompt;
      },
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

    await handleMessage(buildInternalWriteResumeTurn("edit src/cli.ts to rename x to y"));
    expect(openWriteConfirmWith).toBe("");
    expect(replyCalls).toBe(1);
    expect(rows.some((row) => row.role === "assistant" && row.content === "done")).toBe(true);
  });

  test("records interrupted row when active turn is aborted", async () => {
    const rows: ChatRow[] = [];
    let interruptHandler: () => void = () => {};
    let interruptRegistered = false;

    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });

    const handleMessage = createMessageHandler({
      client: createClient({
        reply: async (_input, options) =>
          await new Promise((_, reject) => {
            const abort = (): void => {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            };
            if (options?.signal?.aborted) {
              abort();
              return;
            }
            options?.signal?.addEventListener("abort", abort, { once: true });
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
      setInterrupt: (handler) => {
        interruptRegistered = handler !== null;
        if (handler) interruptHandler = handler;
      },
    });

    const pending = handleMessage("hello");
    for (let i = 0; i < 20 && !interruptRegistered; i += 1) {
      await Bun.sleep(1);
    }
    expect(interruptRegistered).toBe(true);
    interruptHandler();
    await pending;

    const last = rows[rows.length - 1];
    expect(last?.role).toBe("system");
    expect(last?.content).toBe("Interrupted");
    expect(last?.dim).toBe(true);
  });

  test("interrupt followed by next prompt yields clean transcript flow", async () => {
    const rows: ChatRow[] = [];
    let interruptHandler: () => void = () => {};
    let interruptRegistered = false;
    let callCount = 0;

    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });

    const handleMessage = createMessageHandler({
      client: createClient({
        reply: async (_input, options) => {
          const call = callCount++;
          if (call === 0) {
            return await new Promise((_, reject) => {
              const abort = (): void => {
                const error = new Error("Aborted");
                error.name = "AbortError";
                reject(error);
              };
              if (options?.signal?.aborted) {
                abort();
                return;
              }
              options?.signal?.addEventListener("abort", abort, { once: true });
            });
          }
          return { model: "gpt-5-mini", output: "Second answer." };
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
      setProgressText: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: (handler) => {
        interruptRegistered = handler !== null;
        if (handler) interruptHandler = handler;
      },
    });

    const firstPending = handleMessage("First question");
    for (let i = 0; i < 20 && !interruptRegistered; i += 1) {
      await Bun.sleep(1);
    }
    expect(interruptRegistered).toBe(true);
    interruptHandler();
    await firstPending;
    await handleMessage("Second question");

    expect(rows.map((row) => `${row.role}:${row.content}`)).toEqual([
      "user:First question",
      "system:Interrupted",
      "user:Second question",
      "assistant:Second answer.",
    ]);
  });

  test("stops before server call when all @references are unresolved", async () => {
    const rows: ChatRow[] = [];
    let replyCalls = 0;

    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });

    const handleMessage = createMessageHandler({
      client: createClient({
        reply: async () => {
          replyCalls += 1;
          return { model: "gpt-5-mini", output: "ok" };
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
      setProgressText: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await handleMessage("review @definitely-not-a-real-file-xyz");

    expect(replyCalls).toBe(0);
    expect(rows.some((row) => row.content.includes("No file or folder found"))).toBe(true);
  });

  test("continues with resolved @references even when some are unresolved", async () => {
    const rows: ChatRow[] = [];
    let replyCalls = 0;
    const fixture = `tmp-chat-handleMessage-${crypto.randomUUID()}.txt`;
    const fixturePath = join(process.cwd(), fixture);
    await writeFile(fixturePath, "fixture");

    try {
      const session = createSession({ id: "sess_test" });
      const store = createStore({ activeSessionId: session.id, sessions: [session] });

      const handleMessage = createMessageHandler({
        client: createClient({
          reply: async () => {
            replyCalls += 1;
            return { model: "gpt-5-mini", output: "ok" };
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
        setProgressText: () => {},
        setTokenUsage: () => {},
        createMessage,
        nowIso: () => "2026-02-20T00:00:00.000Z",
        setInterrupt: () => {},
      });

      await handleMessage(`review @${fixture} and @definitely-not-a-real-file-xyz`);

      expect(replyCalls).toBe(1);
      expect(rows.some((row) => row.content.includes("No file or folder found"))).toBe(true);
      expect(rows.some((row) => row.role === "assistant" && row.content === "ok")).toBe(true);
    } finally {
      await rm(fixturePath, { force: true });
    }
  });
});
