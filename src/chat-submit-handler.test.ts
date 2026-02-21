import { describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatRow } from "./chat-commands";
import { createSubmitHandler } from "./chat-submit-handler";
import { createBackend, createMessage, createSession, createStore } from "./test-factory";

type Harness = {
  submit: (raw: string) => Promise<void>;
  calls: {
    setInputHistory: number;
    setValue: string[];
    setShowShortcuts: Array<boolean | ((current: boolean) => boolean)>;
  };
};

function createHarness(overrides?: { isThinking?: boolean }): Harness {
  const calls = {
    setInputHistory: 0,
    setValue: [] as string[],
    setShowShortcuts: [] as Array<boolean | ((current: boolean) => boolean)>,
  };
  const session = createSession({ id: "sess_test" });
  const store = createStore({ activeSessionId: session.id, sessions: [session] });
  const submit = createSubmitHandler({
    backend: createBackend({ status: async () => "ok" }),
    store,
    currentSession: session,
    setCurrentSession: () => {},
    toRows: () => [],
    setRows: () => {},
    setShowShortcuts: (next) => {
      calls.setShowShortcuts.push(next);
    },
    setValue: (next) => {
      calls.setValue.push(next);
    },
    persist: async () => {},
    exit: () => {},
    openSkillsPanel: async () => {},
    openResumePanel: () => {},
    tokenUsage: [],
    isThinking: overrides?.isThinking ?? false,
    setInputHistory: () => {
      calls.setInputHistory += 1;
    },
    setInputHistoryIndex: () => {},
    setInputHistoryDraft: () => {},
    setIsThinking: () => {},
    setTokenUsage: () => {},
    createMessage,
    nowIso: () => "2026-02-20T00:00:00.000Z",
    setInterrupt: () => {},
  });
  return { submit, calls };
}

describe("chat submit handler guards", () => {
  test("ignores empty input", async () => {
    const h = createHarness();
    await h.submit("   ");
    expect(h.calls.setInputHistory).toBe(0);
    expect(h.calls.setValue).toEqual([]);
    expect(h.calls.setShowShortcuts).toEqual([]);
  });

  test("ignores input while thinking", async () => {
    const h = createHarness({ isThinking: true });
    await h.submit("hello");
    expect(h.calls.setInputHistory).toBe(0);
    expect(h.calls.setValue).toEqual([]);
  });

  test("ignores unknown single-token slash commands", async () => {
    const h = createHarness();
    await h.submit("/not-a-command");
    expect(h.calls.setInputHistory).toBe(0);
    expect(h.calls.setValue).toEqual([]);
  });

  test("toggles shortcuts on ? input", async () => {
    const h = createHarness();
    await h.submit("?");
    expect(h.calls.setInputHistory).toBe(1);
    expect(h.calls.setValue).toEqual([""]);
    expect(h.calls.setShowShortcuts).toHaveLength(1);
    expect(typeof h.calls.setShowShortcuts[0]).toBe("function");
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
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
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
      tokenUsage: [],
      isThinking: false,
      setInputHistory: () => {},
      setInputHistoryIndex: () => {},
      setInputHistoryDraft: () => {},
      setIsThinking: () => {},
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
        tokenUsage: [],
        isThinking: false,
        setInputHistory: () => {},
        setInputHistoryIndex: () => {},
        setInputHistoryDraft: () => {},
        setIsThinking: () => {},
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
});
