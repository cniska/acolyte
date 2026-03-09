import { describe, expect, test } from "bun:test";
import type { ChatRow } from "./chat-commands";
import { createPickerHandlers } from "./chat-picker-handlers";
import { createMessage, createSession, createStore } from "./test-utils";

describe("chat picker handlers", () => {
  test("openResumePanel shows fallback when no sessions exist", () => {
    const rows: ChatRow[] = [];
    const pickerValues: unknown[] = [];
    const store = createStore({ sessions: [] });
    const currentSession = createSession({ id: "sess_current" });
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
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    handlers.openResumePanel();
    expect(rows.at(-1)?.content).toBe("No saved sessions.");
    expect(pickerValues).toEqual([]);
  });

  test("openResumePanel opens picker and selects active session", () => {
    const pickerValues: unknown[] = [];
    const first = createSession({ id: "sess_first" });
    const second = createSession({ id: "sess_second" });
    const store = createStore({ sessions: [first, second], activeSessionId: second.id });
    const handlers = createPickerHandlers({
      store,
      currentSession: first,
      setCurrentSession: () => {},
      setRows: () => [],
      setRowsDirect: () => {},
      setPicker: (next) => {
        pickerValues.push(next);
      },
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage,
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
    const first = createSession({ id: "sess_first" });
    const second = createSession({ id: "sess_second" });
    const store = createStore({ sessions: [first, second], activeSessionId: first.id });
    const setCurrentSessionCalls = [] as ReturnType<typeof createSession>[];
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
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    await handlers.handlePickerSelect({ kind: "resume", items: [first, second], index: 1 });
    expect(store.activeSessionId).toBe(second.id);
    expect(setCurrentSessionCalls).toEqual([second]);
    expect(setRowsDirectCalls.at(-1)?.at(-1)?.content).toBe("Resumed session: sess_second");
    expect(pickerValues.at(-1)).toBeNull();
  });

  test("handlePickerSelect model applies selected model", async () => {
    const rows: ChatRow[] = [];
    const currentSession = createSession({ id: "sess_current", model: "gpt-5-mini" });
    const store = createStore({ sessions: [currentSession], activeSessionId: currentSession.id });
    const selectedSessions: ReturnType<typeof createSession>[] = [];
    const handlers = createPickerHandlers({
      store,
      currentSession,
      setCurrentSession: (next) => {
        selectedSessions.push(next);
      },
      setRows: (updater) => {
        const next = updater(rows);
        rows.length = 0;
        rows.push(...next);
      },
      setRowsDirect: () => {},
      setPicker: () => {},
      setShowHelp: () => {},
      setValue: () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    await handlers.handlePickerSelect({
      kind: "model",
      items: ["gpt-5-mini", "gpt-5.2"],
      filtered: ["gpt-5-mini", "gpt-5.2"],
      query: "",
      index: 1,
    });

    expect(selectedSessions.at(-1)?.model).toBe("gpt-5.2");
    expect(rows.some((row) => row.content === "Changed default model to gpt-5.2.")).toBe(true);
  });
});
