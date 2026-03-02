import { describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatRow } from "./chat-commands";
import {
  buildInternalWriteResumeTurn,
  createSubmitHandler,
  resolveNaturalRememberDirective,
} from "./chat-submit-handler";
import type { StreamEvent } from "./client";
import {
  createClient,
  createMessage,
  createSession,
  createStore,
  createSubmitHandlerHarness,
  dedent,
} from "./test-utils";

describe("chat submit handler guards", () => {
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
    const { submit, calls } = createSubmitHandlerHarness();
    await submit("   ");
    expect(calls.setInputHistory).toBe(0);
    expect(calls.setValue).toEqual([]);
    expect(calls.setShowHelp).toEqual([]);
  });

  test("ignores input while thinking", async () => {
    const { submit, calls } = createSubmitHandlerHarness({ isWorking: true });
    await submit("hello");
    expect(calls.setInputHistory).toBe(0);
    expect(calls.setValue).toEqual([]);
  });

  test("handles slash command while thinking", async () => {
    const { submit, calls } = createSubmitHandlerHarness({ isWorking: true });
    await submit("/sessions");
    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
  });

  test("ignores unknown single-token slash commands", async () => {
    const { submit, calls } = createSubmitHandlerHarness();
    await submit("/not-a-command");
    expect(calls.setInputHistory).toBe(0);
    expect(calls.setValue).toEqual([]);
  });

  test("routes /status through submit handler and renders status output row", async () => {
    const { submit, rows, calls } = createSubmitHandlerHarness({
      client: createClient({
        status: async () => ({
          provider: "openai",
          model: "gpt-5-mini",
          permissions: "write",
        }),
      }),
    });

    await submit("/status");

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

  test("routes /sessions through submit handler and renders sessions list row", async () => {
    const { submit, rows, calls } = createSubmitHandlerHarness();

    await submit("/sessions");

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

  test("routes /tokens through submit handler and renders token output row", async () => {
    const { submit, rows, calls } = createSubmitHandlerHarness();

    await submit("/tokens");

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
    const { submit, rows } = createSubmitHandlerHarness({
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

    await submit("create a rust script that sums two numbers");
    await submit("update sum.rs to take three instead of two");
    await submit("delete sum.rs");

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
    const { submit, rows } = createSubmitHandlerHarness({
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

    await submit("find all ts files");

    const toolRow = rows.find(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.toolName === "find-files",
    );
    expect(toolRow?.content).toBe("Find *.ts\nsrc/a.ts\nsrc/b.ts\nsrc/c.ts");
  });

  test("merges search summary with pattern context into header", async () => {
    const { submit, rows } = createSubmitHandlerHarness({
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

    await submit("search tool pattern");

    const toolRow = rows.find(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.toolName === "search-files",
    );
    expect(toolRow?.content).toBe("Search paths:2 [tool]\nsrc/a.ts \\btool\\b\nsrc/b.ts \\btool\\b");
  });

  test("toggles shortcuts on ? input", async () => {
    const { submit, calls } = createSubmitHandlerHarness();
    await submit("?");
    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
    expect(calls.setShowHelp).toHaveLength(1);
    expect(typeof calls.setShowHelp[0]).toBe("function");
  });

  test("opens write confirm panel for likely write prompt in read mode", async () => {
    let openWriteConfirmWith = "";
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const submit = createSubmitHandler({
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

    await submit("edit src/cli.ts to rename x to y");
    expect(openWriteConfirmWith).toBe("edit src/cli.ts to rename x to y");
  });

  test("opens write confirm panel for add/fix phrasing in read mode", async () => {
    let openWriteConfirmWith = "";
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const submit = createSubmitHandler({
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

    await submit("add a line break before the resume message");
    expect(openWriteConfirmWith).toBe("add a line break before the resume message");
  });

  test("internal write-resume payload bypasses read-mode write confirm gate", async () => {
    let openWriteConfirmWith = "";
    let replyCalls = 0;
    const rows: ChatRow[] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const submit = createSubmitHandler({
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

    await submit(buildInternalWriteResumeTurn("edit src/cli.ts to rename x to y"));
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

    const submit = createSubmitHandler({
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

    const pending = submit("hello");
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

  test("stops before server call when all @references are unresolved", async () => {
    const rows: ChatRow[] = [];
    let replyCalls = 0;

    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });

    const submit = createSubmitHandler({
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

    await submit("review @definitely-not-a-real-file-xyz");

    expect(replyCalls).toBe(0);
    expect(rows.some((row) => row.content.includes("No file or folder found"))).toBe(true);
  });

  test("continues with resolved @references even when some are unresolved", async () => {
    const rows: ChatRow[] = [];
    let replyCalls = 0;
    const fixture = `tmp-chat-submit-${crypto.randomUUID()}.txt`;
    const fixturePath = join(process.cwd(), fixture);
    await writeFile(fixturePath, "fixture");

    try {
      const session = createSession({ id: "sess_test" });
      const store = createStore({ activeSessionId: session.id, sessions: [session] });

      const submit = createSubmitHandler({
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

      await submit(`review @${fixture} and @definitely-not-a-real-file-xyz`);

      expect(replyCalls).toBe(1);
      expect(rows.some((row) => row.content.includes("No file or folder found"))).toBe(true);
      expect(rows.some((row) => row.role === "assistant" && row.content === "ok")).toBe(true);
    } finally {
      await rm(fixturePath, { force: true });
    }
  });

  test("streams tool-call events into tool progress rows", async () => {
    const rows: ChatRow[] = [];
    const progressTexts: Array<string | null> = [];

    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });

    const submit = createSubmitHandler({
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

    await submit("hello");

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

    const submit = createSubmitHandler({
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

    await submit("hello");

    expect(rows.some((row) => row.role === "assistant" && row.style === "toolProgress")).toBe(false);
    expect(rows.some((row) => row.role === "assistant" && row.content === "done")).toBe(true);
  });

  test("suppresses empty discovery/read tool rows when no body output arrives", async () => {
    const { submit, rows } = createSubmitHandlerHarness({
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

    await submit("search for needle");

    expect(
      rows.some((row) => row.role === "assistant" && row.style === "toolProgress" && row.toolName === "search-files"),
    ).toBe(false);
    expect(rows.some((row) => row.role === "assistant" && row.content === "No matches found.")).toBe(true);
  });

  test("maps quota errors to user-facing submit error", async () => {
    const rows: ChatRow[] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const submit = createSubmitHandler({
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

    await submit("hello");

    expect(rows.some((row) => row.role === "system" && row.content.includes("Provider quota exceeded"))).toBe(true);
  });

  test("maps timeout errors to user-facing submit error", async () => {
    const rows: ChatRow[] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const submit = createSubmitHandler({
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

    await submit("hello");

    expect(rows.some((row) => row.role === "system" && row.content.includes("Server request timed out"))).toBe(true);
  });

  test("recovers cleanly after timeout and allows next submit", async () => {
    const rows: ChatRow[] = [];
    const thinkingTransitions: boolean[] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    let calls = 0;
    const submit = createSubmitHandler({
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

    await submit("first");
    await submit("second");

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
    const submit = createSubmitHandler({
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

    await submit("first");
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
    const submit = createSubmitHandler({
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

    await submit("first");
    await submit("/new");

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
    const submit = createSubmitHandler({
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

    await submit("first");
    await submit(`/resume ${target.id.slice(0, 12)}`);

    expect(calls).toBe(1);
    expect(sawTimeoutRow).toBe(true);
    expect(setCurrentSessionCalls).toEqual([target.id]);
    expect(store.activeSessionId).toBe(target.id);
    expect(rows.some((row) => row.role === "assistant" && row.content === "resumed")).toBe(true);
  });

  test("creates a single tool row per streamed tool-call event", async () => {
    const { submit, rows } = createSubmitHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [{ type: "tool-call", toolCallId: "call_1", toolName: "run-command", args: { command: "echo hi" } }],
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
        }),
      }),
    });

    await submit("hello");

    const runRows = rows.filter(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content.startsWith("Run"),
    );
    expect(runRows.length).toBe(1);
    expect(runRows[0]?.content).toBe("Run echo hi\n(No output)");
  });

  test("renders streamed tool rows before assistant summary row", async () => {
    const { submit, rows } = createSubmitHandlerHarness({
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

    await submit("hello");

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
    const { submit, rows, session } = createSubmitHandlerHarness({
      client: createClient({
        status: async () => ({}),
        events: [{ type: "text-delta", text: streamed }],
        reply: async () => ({
          model: "gpt-5-mini",
          output: "This is a long streamed answer",
        }),
      }),
    });

    await submit("hello");

    expect(rows.some((row) => row.role === "assistant" && row.content === streamed)).toBe(true);
    expect(session.messages.some((message) => message.role === "assistant" && message.content === streamed)).toBe(true);
  });

  test("creates a single tool row when tool-call is followed by tool-result", async () => {
    const { submit, rows } = createSubmitHandlerHarness({
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

    await submit("hello");

    const editedRows = rows.filter(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content.startsWith("Edit sum.rs"),
    );
    expect(editedRows).toHaveLength(1);
    expect(editedRows[0]?.content).toBe("Edit sum.rs");
  });

  test("suppresses guard-blocked tool attempts", async () => {
    const { submit, rows } = createSubmitHandlerHarness({
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

    await submit("hello");

    const toolRows = rows.filter((row) => row.role === "assistant" && row.style === "toolProgress");
    expect(toolRows).toHaveLength(0);
  });

  test("merges tool-output into tool-call row in real time", async () => {
    const { submit, rows } = createSubmitHandlerHarness({
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

    await submit("hello");

    const editedRows = rows.filter(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content.startsWith("Edit sum.rs"),
    );
    expect(editedRows).toHaveLength(1);
    expect(editedRows[0]?.content).toBe("Edit sum.rs\n1 + fn main() {}");
  });

  test("ignores duplicate tool-output lines for the same tool row", async () => {
    const { submit, rows } = createSubmitHandlerHarness({
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

    await submit("hello");

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
    const { submit, rows } = createSubmitHandlerHarness({
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

    await submit("create file");
    await submit("edit file");

    const editedRows = rows.filter(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content.startsWith("Edit sum.rs"),
    );
    expect(editedRows).toHaveLength(2);
    expect(editedRows[0]?.content).toBe("Edit sum.rs\n1 + fn main() {}");
    expect(editedRows[1]?.content).toBe('Edit sum.rs\n2 + println!("ok");');
  });

  test("keeps same-header tool rows separate when toolCallId differs in one turn", async () => {
    const { submit, rows } = createSubmitHandlerHarness({
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

    await submit("hello");

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

    const submit = createSubmitHandler({
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

    await submit("hello");

    expect(session.tokenUsage.length).toBe(1);
    expect(session.tokenUsage[0]?.usage.totalTokens).toBe(20);
    expect(session.tokenUsage[0]?.modelCalls).toBe(3);
    expect(tokenUsageSnapshots.length).toBe(1);
    expect(tokenUsageSnapshots[0]).toEqual(session.tokenUsage);
  });
});
