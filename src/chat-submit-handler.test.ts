import { describe, expect, test } from "bun:test";
import { createSubmitHandler } from "./chat-submit-handler";
import type { Message, Session, SessionStore } from "./types";

function makeMessage(role: Message["role"], content: string): Message {
  return {
    id: "msg_test",
    role,
    content,
    timestamp: "2026-02-20T00:00:00.000Z",
  };
}

function makeSession(): Session {
  return {
    id: "sess_test",
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
    model: "gpt-5-mini",
    title: "New Session",
    messages: [],
  };
}

type Harness = {
  submit: (raw: string) => Promise<void>;
  calls: {
    setInputHistory: number;
    setValue: string[];
    setShowShortcuts: Array<boolean | ((current: boolean) => boolean)>;
  };
};

function makeHarness(overrides?: { isThinking?: boolean }): Harness {
  const calls = {
    setInputHistory: 0,
    setValue: [] as string[],
    setShowShortcuts: [] as Array<boolean | ((current: boolean) => boolean)>,
  };
  const session = makeSession();
  const store: SessionStore = {
    activeSessionId: session.id,
    sessions: [session],
  };
  const submit = createSubmitHandler({
    backend: {
      reply: async () => ({ model: "gpt-5-mini", output: "ok" }),
      status: async () => "ok",
    },
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
    createMessage: makeMessage,
    nowIso: () => "2026-02-20T00:00:00.000Z",
  });
  return { submit, calls };
}

describe("chat submit handler guards", () => {
  test("ignores empty input", async () => {
    const h = makeHarness();
    await h.submit("   ");
    expect(h.calls.setInputHistory).toBe(0);
    expect(h.calls.setValue).toEqual([]);
    expect(h.calls.setShowShortcuts).toEqual([]);
  });

  test("ignores input while thinking", async () => {
    const h = makeHarness({ isThinking: true });
    await h.submit("hello");
    expect(h.calls.setInputHistory).toBe(0);
    expect(h.calls.setValue).toEqual([]);
  });

  test("ignores unknown single-token slash commands", async () => {
    const h = makeHarness();
    await h.submit("/not-a-command");
    expect(h.calls.setInputHistory).toBe(0);
    expect(h.calls.setValue).toEqual([]);
  });

  test("toggles shortcuts on ? input", async () => {
    const h = makeHarness();
    await h.submit("?");
    expect(h.calls.setInputHistory).toBe(1);
    expect(h.calls.setValue).toEqual([""]);
    expect(h.calls.setShowShortcuts).toHaveLength(1);
    expect(typeof h.calls.setShowShortcuts[0]).toBe("function");
  });
});
