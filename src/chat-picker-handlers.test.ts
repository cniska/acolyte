import { describe, expect, test } from "bun:test";
import { appConfig, setPermissionMode } from "./app-config";
import type { ChatRow } from "./chat-commands";
import { createPickerHandlers } from "./chat-picker-handlers";
import { createMessage, createSession, createStore } from "./test-factory";

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
      setShowShortcuts: () => {},
      setPendingPolicyCandidate: () => {},
      setValue: () => {},
      setBackendPermissionMode: async () => {},
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
      setShowShortcuts: () => {},
      setPendingPolicyCandidate: () => {},
      setValue: () => {},
      setBackendPermissionMode: async () => {},
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
      setShowShortcuts: () => {},
      setPendingPolicyCandidate: () => {},
      setValue: () => {},
      setBackendPermissionMode: async () => {},
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

  test("openPermissionsPanel opens permissions picker and handlePickerSelect applies it", async () => {
    const prev = appConfig.agent.permissions.mode;
    setPermissionMode("write");
    const pickerValues: unknown[] = [];
    const rows: ChatRow[] = [];
    const currentSession = createSession({ id: "sess_current" });
    const store = createStore({ sessions: [currentSession], activeSessionId: currentSession.id });
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
      setPendingPolicyCandidate: () => {},
      setValue: () => {},
      setBackendPermissionMode: async () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    try {
      handlers.openPermissionsPanel();
      const picker = pickerValues.at(-1) as { kind: string; items: Array<{ mode: string }>; index: number };
      expect(picker.kind).toBe("permissions");
      expect(picker.items.length).toBe(2);

      await handlers.handlePickerSelect({
        kind: "permissions",
        items: [
          { mode: "read", description: "inspect/search only" },
          { mode: "write", description: "allow edits and shell commands" },
        ],
        index: 0,
      });
      expect(appConfig.agent.permissions.mode).toBe("read");
      expect(rows.some((row) => row.content === "permission mode: read")).toBe(true);
    } finally {
      setPermissionMode(prev);
    }
  });

  test("handlePickerSelect policy stores pending confirmation", async () => {
    let pending: unknown = null;
    const rows: ChatRow[] = [];
    const pickerValues: unknown[] = [];
    const currentSession = createSession({ id: "sess_current" });
    const store = createStore({ sessions: [currentSession], activeSessionId: currentSession.id });
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
      setPendingPolicyCandidate: (next) => {
        pending = next;
      },
      setValue: () => {},
      setBackendPermissionMode: async () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    await handlers.handlePickerSelect({
      kind: "policy",
      items: [{ normalized: "keep output concise", count: 3, examples: ["we should keep output concise"] }],
      index: 0,
    });
    expect(pending).toMatchObject({ normalized: "keep output concise" });
    expect(rows).toHaveLength(0);
    expect(pickerValues.at(-1)).toMatchObject({ kind: "policyConfirm" });
  });

  test("openPolicyPanel opens confirm picker directly for one candidate", () => {
    let pending: unknown = null;
    const pickerValues: unknown[] = [];
    const currentSession = createSession({ id: "sess_current" });
    const store = createStore({ sessions: [currentSession], activeSessionId: currentSession.id });
    const handlers = createPickerHandlers({
      store,
      currentSession,
      setCurrentSession: () => {},
      setRows: () => {},
      setRowsDirect: () => {},
      setPicker: (next) => {
        pickerValues.push(next);
      },
      setShowShortcuts: () => {},
      setPendingPolicyCandidate: (next) => {
        pending = next;
      },
      setValue: () => {},
      setBackendPermissionMode: async () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    handlers.openPolicyPanel([{ normalized: "keep output concise", count: 2, examples: [] }]);
    expect(pending).toMatchObject({ normalized: "keep output concise" });
    expect(pickerValues.at(-1)).toMatchObject({ kind: "policyConfirm" });
  });

  test("handlePickerSelect writeConfirm switch updates mode and pre-fills prompt", async () => {
    const rows: ChatRow[] = [];
    const values: string[] = [];
    const currentSession = createSession({ id: "sess_current" });
    const store = createStore({ sessions: [currentSession], activeSessionId: currentSession.id });
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
      setPicker: () => {},
      setShowShortcuts: () => {},
      setPendingPolicyCandidate: () => {},
      setValue: (next) => {
        values.push(next);
      },
      setBackendPermissionMode: async (next) => {
        expect(next).toBe("write");
      },
      persist: async () => {},
      toRows: () => [],
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    await handlers.handlePickerSelect({
      kind: "writeConfirm",
      prompt: "edit src/cli.ts",
      items: [
        { value: "switch", description: "switch to write mode" },
        { value: "cancel", description: "keep read mode" },
      ],
      index: 0,
      note: "temporary",
    });
    expect(values.at(-1)).toBe("edit src/cli.ts");
    expect(rows.some((row) => row.content.includes("permission mode: write"))).toBe(true);
  });
});
