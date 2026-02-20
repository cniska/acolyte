import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-commands";
import { createPickerHandlers } from "./chat-picker-handlers";
import type { Session, SessionStore } from "./types";

function makeSession(id: string, title = "New Session"): Session {
  return {
    id,
    title,
    model: "gpt-5-mini",
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
    messages: [],
  };
}

describe("chat picker handlers", () => {
  test("openResumePanel shows fallback when no sessions exist", () => {
    const rows: ChatRow[] = [];
    const pickerValues: unknown[] = [];
    const store: SessionStore = { sessions: [] };
    const currentSession = makeSession("sess_current");
    const handlers = createPickerHandlers({
      store,
      currentSession,
      setCurrentSession: () => {},
      setRows: (updater) => {
        const next = updater(rows);
        rows.length = 0;
        rows.push(...next);
      },
      setRowsDirect: () => {},
      setPicker: (next) => {
        pickerValues.push(next);
      },
      setShowShortcuts: () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage: (role, content) => ({
        id: "msg_test",
        role,
        content,
        timestamp: "2026-02-20T00:00:00.000Z",
      }),
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    handlers.openResumePanel();
    expect(rows.at(-1)?.content).toBe("No saved sessions.");
    expect(pickerValues).toEqual([]);
  });

  test("openResumePanel opens picker and selects active session", () => {
    const pickerValues: unknown[] = [];
    const first = makeSession("sess_first");
    const second = makeSession("sess_second");
    const store: SessionStore = {
      sessions: [first, second],
      activeSessionId: second.id,
    };
    const handlers = createPickerHandlers({
      store,
      currentSession: first,
      setCurrentSession: () => {},
      setRows: () => [],
      setRowsDirect: () => {},
      setPicker: (next) => {
        pickerValues.push(next);
      },
      setShowShortcuts: () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage: (role, content) => ({
        id: "msg_test",
        role,
        content,
        timestamp: "2026-02-20T00:00:00.000Z",
      }),
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    handlers.openResumePanel();
    expect(pickerValues).toHaveLength(1);
    expect(pickerValues[0]).toMatchObject({
      kind: "resume",
      index: 1,
    });
  });

  test("handlePickerSelect resumes selected session", async () => {
    const first = makeSession("sess_first");
    const second = makeSession("sess_second");
    const store: SessionStore = {
      sessions: [first, second],
      activeSessionId: first.id,
    };
    const setCurrentSessionCalls: Session[] = [];
    const setRowsDirectCalls: ChatRow[][] = [];
    const pickerValues: unknown[] = [];
    const handlers = createPickerHandlers({
      store,
      currentSession: first,
      setCurrentSession: (next) => {
        setCurrentSessionCalls.push(next);
      },
      setRows: () => [],
      setRowsDirect: (next) => {
        setRowsDirectCalls.push(next);
      },
      setPicker: (next) => {
        pickerValues.push(next);
      },
      setShowShortcuts: () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage: (role, content) => ({
        id: "msg_test",
        role,
        content,
        timestamp: "2026-02-20T00:00:00.000Z",
      }),
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    await handlers.handlePickerSelect({ kind: "resume", items: [first, second], index: 1 });
    expect(store.activeSessionId).toBe(second.id);
    expect(setCurrentSessionCalls).toEqual([second]);
    expect(setRowsDirectCalls.at(-1)?.at(-1)?.content).toBe("Resumed session: sess_second");
    expect(pickerValues.at(-1)).toBeNull();
  });
});
