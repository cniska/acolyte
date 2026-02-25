import { describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatRow } from "./chat-commands";
import {
  buildInternalWriteResumeTurn,
  createSubmitHandler,
  extractClarifyingQuestions,
  resolveNaturalRememberDirective,
} from "./chat-submit-handler";
import { createBackend, createMessage, createSession, createStore, createSubmitHandlerHarness } from "./test-factory";

describe("chat submit handler guards", () => {
  test("extractClarifyingQuestions reads numbered clarify blocks", () => {
    const output = [
      "Risks/assumptions: unsure where release-note automation lives.",
      "",
      "Clarifying questions:",
      "1. Where is release-notes generation triggered?",
      "2. Should filters be case-insensitive?",
      "3. Any CI consumer to adjust?",
      "",
      "Next steps: answer these first.",
    ].join("\n");
    expect(extractClarifyingQuestions(output)).toEqual([
      "Where is release-notes generation triggered?",
      "Should filters be case-insensitive?",
      "Any CI consumer to adjust?",
    ]);
  });

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
    expect(calls.setShowShortcuts).toEqual([]);
  });

  test("ignores input while thinking", async () => {
    const { submit, calls } = createSubmitHandlerHarness({ isThinking: true });
    await submit("hello");
    expect(calls.setInputHistory).toBe(0);
    expect(calls.setValue).toEqual([]);
  });

  test("handles slash command while thinking", async () => {
    const { submit, calls } = createSubmitHandlerHarness({ isThinking: true });
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

  test("keeps create-edit-delete tool output visible across submits", async () => {
    const replies = [
      { model: "gpt-5-mini", output: "Created sum.rs.", progressMessages: ["Edited sum.rs"] },
      {
        model: "gpt-5-mini",
        output: "Updated sum.rs for three args.",
        progressMessages: ["Edited sum.rs", "2 - let sum = a + b;", "2 + let sum = a + b + c;"],
      },
      { model: "gpt-5-mini", output: "Removed sum.rs.", progressMessages: ["Deleted sum.rs"] },
    ];
    const { submit, rows } = createSubmitHandlerHarness({
      backend: createBackend({
        status: async () => "ok",
        progress: async () => null,
        reply: async () => replies.shift() ?? { model: "gpt-5-mini", output: "done" },
      }),
    });

    await submit("create a rust script that sums two numbers");
    await submit("update sum.rs to take three instead of two");
    await submit("delete sum.rs");

    const toolRows = rows.filter((row) => row.role === "assistant" && row.style === "toolProgress");
    expect(toolRows.map((row) => row.content)).toEqual([
      "Edited sum.rs",
      "Edited sum.rs\n2 - let sum = a + b;\n2 + let sum = a + b + c;",
      "Deleted sum.rs",
    ]);
    expect(rows.some((row) => row.role === "assistant" && row.content === "Created sum.rs.")).toBe(true);
    expect(rows.some((row) => row.role === "assistant" && row.content === "Updated sum.rs for three args.")).toBe(true);
    expect(rows.some((row) => row.role === "assistant" && row.content === "Removed sum.rs.")).toBe(true);
  });

  test("toggles shortcuts on ? input", async () => {
    const { submit, calls } = createSubmitHandlerHarness();
    await submit("?");
    expect(calls.setInputHistory).toBe(1);
    expect(calls.setValue).toEqual([""]);
    expect(calls.setShowShortcuts).toHaveLength(1);
    expect(typeof calls.setShowShortcuts[0]).toBe("function");
  });

  test("handles pending policy confirmation with note", async () => {
    const rows: ChatRow[] = [];
    let pending: { normalized: string; count: number; examples: string[] } | null = {
      normalized: "keep output concise",
      count: 2,
      examples: [],
    };
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const submit = createSubmitHandler({
      backend: createBackend({ status: async () => "ok" }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (_questions, _originalPrompt) => {},
      openWriteConfirmPanel: () => {},
      pendingPolicyCandidate: pending,
      setPendingPolicyCandidate: (next) => {
        pending = next;
      },
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await submit("yes also do this");
    expect(pending).toBeNull();
    expect(rows.some((row) => row.content.includes("Policy draft confirmed: keep output concise"))).toBe(true);
    expect(rows.some((row) => row.content.includes("note: also do this"))).toBe(true);
  });

  test("opens write confirm panel for likely write prompt in read mode", async () => {
    let openWriteConfirmWith = "";
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const submit = createSubmitHandler({
      backend: createBackend({
        status: async () => "provider=openai permission_mode=read",
        reply: async () => ({ model: "gpt-5-mini", output: "ok" }),
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: () => {},
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (_questions, _originalPrompt) => {},
      openWriteConfirmPanel: (prompt) => {
        openWriteConfirmWith = prompt;
      },
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
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
      backend: createBackend({
        status: async () => "provider=openai permission_mode=read",
        reply: async () => ({ model: "gpt-5-mini", output: "ok" }),
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: () => {},
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (_questions, _originalPrompt) => {},
      openWriteConfirmPanel: (prompt) => {
        openWriteConfirmWith = prompt;
      },
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
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
      backend: createBackend({
        status: async () => "provider=openai permission_mode=read",
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
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (_questions, _originalPrompt) => {},
      openWriteConfirmPanel: (prompt) => {
        openWriteConfirmWith = prompt;
      },
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
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
      backend: createBackend({
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
        status: async () => "ok",
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (_questions, _originalPrompt) => {},
      openWriteConfirmPanel: () => {},
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: (handler) => {
        interruptRegistered = handler !== null;
        if (handler) {
          interruptHandler = handler;
        }
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
    expect(last?.content).toBe("Interrupted.");
    expect(last?.dim).toBe(true);
  });

  test("suppresses raw assistant output and opens clarify picker when clarification is needed", async () => {
    const rows: ChatRow[] = [];
    const openedClarify: string[][] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const submit = createSubmitHandler({
      backend: createBackend({
        status: async () => "ok",
        reply: async () => ({
          model: "gpt-5-mini",
          output: [
            "Risks/assumptions: unsure where release-note automation lives.",
            "",
            "Clarifying questions:",
            "1. Where is release-notes generation triggered?",
            "2. Should filters be case-insensitive?",
          ].join("\n"),
        }),
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (questions, _originalPrompt) => {
        openedClarify.push(questions);
      },
      openWriteConfirmPanel: () => {},
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await submit("what next");
    expect(openedClarify).toHaveLength(1);
    expect(openedClarify[0]).toEqual([
      "Where is release-notes generation triggered?",
      "Should filters be case-insensitive?",
    ]);
    expect(rows.some((row) => row.content.includes("Clarification needed before continuing:"))).toBe(false);
    expect(rows.some((row) => row.content.includes("Risks/assumptions"))).toBe(false);
    expect(
      session.messages.some((message) => message.role === "assistant" && message.content.includes("Risks/assumptions")),
    ).toBe(false);
  });

  test("stops before backend call when all @references are unresolved", async () => {
    const rows: ChatRow[] = [];
    let replyCalls = 0;

    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });

    const submit = createSubmitHandler({
      backend: createBackend({
        reply: async () => {
          replyCalls += 1;
          return { model: "gpt-5-mini", output: "ok" };
        },
        status: async () => "ok",
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (_questions, _originalPrompt) => {},
      openWriteConfirmPanel: () => {},
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
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
        backend: createBackend({
          reply: async () => {
            replyCalls += 1;
            return { model: "gpt-5-mini", output: "ok" };
          },
          status: async () => "ok",
        }),
        store,
        currentSession: session,
        setCurrentSession: () => {},
        toRows: () => [],
        setRows: (updater) => {
          rows.splice(0, rows.length, ...updater(rows));
        },
        setShowShortcuts: () => {},
        setValue: () => {},
        persist: async () => {},
        exit: () => {},
        openSkillsPanel: async () => {},
        openResumePanel: () => {},
        openPermissionsPanel: () => {},
        openPolicyPanel: () => {},
        openClarifyPanel: (_questions, _originalPrompt) => {},
        openWriteConfirmPanel: () => {},
        pendingPolicyCandidate: null,
        setPendingPolicyCandidate: () => {},
        tokenUsage: [],
        isThinking: false,
        setInputHistory: () => {},
        setInputHistoryIndex: () => {},
        setInputHistoryDraft: () => {},
        setIsThinking: () => {},
        setThinkingLabel: () => {},
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

  test("updates a single thinking label from progress events", async () => {
    const rows: ChatRow[] = [];
    const thinkingLabels: Array<string | null> = [];
    let progressCalls = 0;

    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });

    const submit = createSubmitHandler({
      backend: createBackend({
        reply: async () => {
          await Bun.sleep(700);
          return { model: "gpt-5-mini", output: "done" };
        },
        progress: async () => {
          progressCalls += 1;
          if (progressCalls === 1) {
            return {
              sessionId: "sess_test",
              requestId: "req_1",
              done: false,
              events: [
                { seq: 1, message: "Working…" },
                { seq: 2, message: "Run" },
              ],
            };
          }
          return { sessionId: "sess_test", requestId: "req_1", done: false, events: [] };
        },
        status: async () => "ok",
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (_questions, _originalPrompt) => {},
      openWriteConfirmPanel: () => {},
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: (next) => {
        thinkingLabels.push(next);
      },
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await submit("hello");

    expect(thinkingLabels[0]).toBe("Working…");
    expect(thinkingLabels).toContain("Working…");
    expect(thinkingLabels.at(-1)).toBeNull();
    expect(rows.some((row) => row.role === "assistant" && row.style === "toolProgress")).toBe(true);
    expect(rows.some((row) => row.role === "system" && row.content.includes("Working…"))).toBe(false);
    expect(rows.some((row) => row.role === "assistant" && row.content === "done")).toBe(true);
  });

  test("does not add generic tool rows when progress stream is empty", async () => {
    const rows: ChatRow[] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });

    const submit = createSubmitHandler({
      backend: createBackend({
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
          toolCalls: ["run-command"],
        }),
        progress: async () => ({ sessionId: "sess_test", requestId: "req_1", done: false, events: [] }),
        status: async () => "ok",
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: () => {},
      openWriteConfirmPanel: () => {},
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await submit("hello");

    expect(rows.some((row) => row.role === "assistant" && row.style === "toolProgress")).toBe(false);
    expect(rows.some((row) => row.role === "assistant" && row.content === "done")).toBe(true);
  });

  test("maps quota errors to user-facing submit error", async () => {
    const rows: ChatRow[] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const submit = createSubmitHandler({
      backend: createBackend({
        status: async () => "ok",
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
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (_questions, _originalPrompt) => {},
      openWriteConfirmPanel: () => {},
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
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
      backend: createBackend({
        status: async () => "ok",
        reply: async () => {
          throw new Error("Remote backend reply timed out after 120000ms");
        },
      }),
      store,
      currentSession: session,
      setCurrentSession: () => {},
      toRows: () => [],
      setRows: (updater) => {
        rows.splice(0, rows.length, ...updater(rows));
      },
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (_questions, _originalPrompt) => {},
      openWriteConfirmPanel: () => {},
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await submit("hello");

    expect(rows.some((row) => row.role === "system" && row.content.includes("Backend request timed out"))).toBe(true);
  });

  test("recovers cleanly after timeout and allows next submit", async () => {
    const rows: ChatRow[] = [];
    const thinkingTransitions: boolean[] = [];
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    let calls = 0;
    const submit = createSubmitHandler({
      backend: createBackend({
        status: async () => "ok",
        reply: async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error("Remote backend reply timed out after 120000ms");
          }
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
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (_questions, _originalPrompt) => {},
      openWriteConfirmPanel: () => {},
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: (next) => {
        thinkingTransitions.push(next);
      },
      setThinkingLabel: () => {},
      setTokenUsage: () => {},
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
      setInterrupt: () => {},
    });

    await submit("first");
    await submit("second");

    expect(calls).toBe(2);
    expect(thinkingTransitions).toEqual([true, false, true, false]);
    expect(rows.some((row) => row.role === "system" && row.content.includes("Backend request timed out"))).toBe(true);
    expect(rows.some((row) => row.role === "assistant" && row.content === "ok")).toBe(true);
  });

  test("allows /new recovery after a timed-out turn", async () => {
    const rows: ChatRow[] = [];
    let sawTimeoutRow = false;
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const setCurrentSessionCalls: string[] = [];
    let calls = 0;
    const submit = createSubmitHandler({
      backend: createBackend({
        status: async () => "ok",
        reply: async () => {
          calls += 1;
          throw new Error("Remote backend reply timed out after 120000ms");
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
        if (next.some((row) => row.role === "system" && row.content.includes("Backend request timed out"))) {
          sawTimeoutRow = true;
        }
        rows.splice(0, rows.length, ...next);
      },
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (_questions, _originalPrompt) => {},
      openWriteConfirmPanel: () => {},
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
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
      backend: createBackend({
        status: async () => "ok",
        reply: async () => {
          calls += 1;
          throw new Error("Remote backend reply timed out after 120000ms");
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
        if (next.some((row) => row.role === "system" && row.content.includes("Backend request timed out"))) {
          sawTimeoutRow = true;
        }
        rows.splice(0, rows.length, ...next);
      },
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: (_questions, _originalPrompt) => {},
      openWriteConfirmPanel: () => {},
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
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

  test("dedupes fallback tool progress when same tool was streamed", async () => {
    let progressCalls = 0;
    const { submit, rows } = createSubmitHandlerHarness({
      backend: createBackend({
        status: async () => "ok",
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
          toolCalls: ["run-command"],
        }),
        progress: async () => {
          progressCalls += 1;
          if (progressCalls === 1) {
            return {
              sessionId: "sess_test",
              requestId: "req_1",
              done: false,
              events: [{ seq: 1, message: "Run" }],
            };
          }
          return { sessionId: "sess_test", requestId: "req_1", done: false, events: [] };
        },
      }),
    });

    await submit("hello");

    const runRows = rows.filter(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content === "Run",
    );
    expect(runRows.length).toBe(1);
  });

  test("upgrades streamed header-only tool row when detailed row arrives", async () => {
    let progressCalls = 0;
    const { submit, rows } = createSubmitHandlerHarness({
      backend: createBackend({
        status: async () => "ok",
        reply: async () => ({
          model: "gpt-5-mini",
          output: "done",
          progressMessages: ["Edited sum.rs\n1 + fn main() {}"],
        }),
        progress: async () => {
          progressCalls += 1;
          if (progressCalls === 1) {
            return {
              sessionId: "sess_test",
              requestId: "req_1",
              done: false,
              events: [{ seq: 1, message: "Edited sum.rs" }],
            };
          }
          return { sessionId: "sess_test", requestId: "req_1", done: false, events: [] };
        },
      }),
    });

    await submit("hello");

    const editedRows = rows.filter(
      (row) => row.role === "assistant" && row.style === "toolProgress" && row.content.startsWith("Edited sum.rs"),
    );
    expect(editedRows).toHaveLength(1);
    expect(editedRows[0]?.content).toBe("Edited sum.rs\n1 + fn main() {}");
  });

  test("persists token usage on successful turn", async () => {
    const session = createSession({ id: "sess_test" });
    const store = createStore({ activeSessionId: session.id, sessions: [session] });
    const tokenUsageSnapshots: Array<typeof session.tokenUsage> = [];

    const submit = createSubmitHandler({
      backend: createBackend({
        status: async () => "ok",
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
      setShowShortcuts: () => {},
      setValue: () => {},
      persist: async () => {},
      exit: () => {},
      openSkillsPanel: async () => {},
      openResumePanel: () => {},
      openPermissionsPanel: () => {},
      openPolicyPanel: () => {},
      openClarifyPanel: () => {},
      openWriteConfirmPanel: () => {},
      pendingPolicyCandidate: null,
      setPendingPolicyCandidate: () => {},
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
      setThinkingLabel: () => {},
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
