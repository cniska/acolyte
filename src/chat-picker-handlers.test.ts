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
      queueInput: () => {},
      buildClarificationPayload: () => "",
      buildWriteResumePayload: (prompt) => prompt,
      setBackendPermissionMode: async () => {},
      persistPermissionMode: async () => {},
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
      queueInput: () => {},
      buildClarificationPayload: () => "",
      buildWriteResumePayload: (prompt) => prompt,
      setBackendPermissionMode: async () => {},
      persistPermissionMode: async () => {},
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
      queueInput: () => {},
      buildClarificationPayload: () => "",
      buildWriteResumePayload: (prompt) => prompt,
      setBackendPermissionMode: async () => {},
      persistPermissionMode: async () => {},
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
    const persisted: Array<{ mode: "read" | "write"; scope: "project" | "user" }> = [];
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
      queueInput: () => {},
      buildClarificationPayload: () => "",
      buildWriteResumePayload: (prompt) => prompt,
      setBackendPermissionMode: async () => {},
      persistPermissionMode: async (mode, scope) => {
        persisted.push({ mode, scope });
      },
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
      expect(rows.some((row) => row.content === "Changed permissions to read (project).")).toBe(true);
      expect(
        rows.some((row) => row.role === "system" && row.content === "Changed permissions to read (project)."),
      ).toBe(true);
      expect(persisted).toEqual([{ mode: "read", scope: "project" }]);
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
      queueInput: () => {},
      buildClarificationPayload: () => "",
      buildWriteResumePayload: (prompt) => prompt,
      setBackendPermissionMode: async () => {},
      persistPermissionMode: async () => {},
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
      queueInput: () => {},
      buildClarificationPayload: () => "",
      buildWriteResumePayload: (prompt) => prompt,
      setBackendPermissionMode: async () => {},
      persistPermissionMode: async () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    handlers.openPolicyPanel([{ normalized: "keep output concise", count: 2, examples: [] }]);
    expect(pending).toMatchObject({ normalized: "keep output concise" });
    expect(pickerValues.at(-1)).toMatchObject({ kind: "policyConfirm" });
  });

  test("handlePickerSelect policyConfirm appends assistant outcome for yes/no", async () => {
    const rows: ChatRow[] = [];
    const pendingValues: unknown[] = [];
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
      setPendingPolicyCandidate: (next) => {
        pendingValues.push(next);
      },
      setValue: () => {},
      queueInput: () => {},
      buildClarificationPayload: () => "",
      buildWriteResumePayload: (prompt) => prompt,
      setBackendPermissionMode: async () => {},
      persistPermissionMode: async () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    await handlers.handlePickerSelect({
      kind: "policyConfirm",
      item: { normalized: "keep output concise", count: 2, examples: [] },
      items: [
        { value: "yes", description: "accept this draft" },
        { value: "no", description: "skip this draft" },
      ],
      index: 0,
      note: "",
    });
    expect(rows.at(-1)).toMatchObject({
      role: "assistant",
      content: "Policy draft confirmed: keep output concise",
    });

    await handlers.handlePickerSelect({
      kind: "policyConfirm",
      item: { normalized: "keep output concise", count: 2, examples: [] },
      items: [
        { value: "yes", description: "accept this draft" },
        { value: "no", description: "skip this draft" },
      ],
      index: 1,
      note: "",
    });
    expect(rows.at(-1)).toMatchObject({
      role: "assistant",
      content: "Policy draft skipped.",
    });
    expect(pendingValues.at(-1)).toBeNull();
  });

  test("openClarifyPanel opens one-question clarify picker and captures answers sequentially", async () => {
    const pickerValues: unknown[] = [];
    const rows: ChatRow[] = [];
    const queued: string[] = [];
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
      queueInput: (next) => {
        queued.push(next);
      },
      buildClarificationPayload: ({ originalPrompt, answers }) => JSON.stringify({ originalPrompt, answers }),
      buildWriteResumePayload: (prompt) => prompt,
      setBackendPermissionMode: async () => {},
      persistPermissionMode: async () => {},
      persist: async () => {},
      toRows: () => [],
      createMessage,
      nowIso: () => "2026-02-20T00:00:00.000Z",
    });

    handlers.openClarifyPanel(["First question?", "Second question?"], "implement feature x");
    expect(pickerValues.at(-1)).toMatchObject({ kind: "clarifyAnswer", question: "First question?" });

    await handlers.handlePickerSelect({
      kind: "clarifyAnswer",
      originalPrompt: "implement feature x",
      question: "First question?",
      remaining: ["Second question?"],
      answers: [],
      items: [{ value: "continue", description: "continue to next question" }],
      index: 0,
      note: "first answer",
    });
    expect(pickerValues.at(-1)).toMatchObject({ kind: "clarifyAnswer", question: "Second question?" });

    await handlers.handlePickerSelect({
      kind: "clarifyAnswer",
      originalPrompt: "implement feature x",
      question: "Second question?",
      remaining: [],
      answers: [{ question: "First question?", answer: "first answer" }],
      items: [{ value: "continue", description: "continue to next question" }],
      index: 0,
      note: "second answer",
    });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toContain('"originalPrompt":"implement feature x"');
    expect(queued[0]).toContain('"answer":"second answer"');
    expect(rows.some((row) => row.content.includes("Captured 2 clarifications."))).toBe(true);
    expect(pickerValues.at(-1)).toBeNull();
  });

  test("handlePickerSelect writeConfirm switch updates mode and auto-queues prompt", async () => {
    const rows: ChatRow[] = [];
    const values: string[] = [];
    const queued: string[] = [];
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
      queueInput: (next) => {
        queued.push(next);
      },
      buildClarificationPayload: () => "",
      buildWriteResumePayload: (prompt) => `resume:${prompt}`,
      setBackendPermissionMode: async (next) => {
        expect(next).toBe("write");
      },
      persistPermissionMode: async (mode, scope) => {
        expect(mode).toBe("write");
        expect(scope).toBe("project");
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
        { value: "cancel", description: "stay in read mode" },
      ],
      index: 0,
      note: "temporary",
    });
    expect(values.at(-1)).toBe("");
    expect(queued.at(-1)).toBe("resume:edit src/cli.ts");
    expect(rows.some((row) => row.content.includes("Changed permissions to write"))).toBe(true);
  });
});
