import { describe, expect, test } from "bun:test";
import { createPickerHandlerHarness, createSession, createSessionState } from "./test-utils";

describe("chat picker handlers", () => {
  test("openResumePanel shows fallback when no sessions exist", () => {
    const sessionState = createSessionState({ sessions: [] });
    const { handlers, spies } = createPickerHandlerHarness({ sessionState });

    handlers.openResumePanel();
    expect(spies.rows.at(-1)?.content).toBe("No saved sessions.");
    expect(spies.pickerValues).toEqual([]);
  });

  test("openResumePanel opens picker and selects active session", () => {
    const first = createSession({ id: "sess_first" });
    const second = createSession({ id: "sess_second" });
    const sessionState = createSessionState({ sessions: [first, second], activeSessionId: second.id });
    const { handlers, spies } = createPickerHandlerHarness({ sessionState, currentSession: first });

    handlers.openResumePanel();
    expect(spies.pickerValues).toHaveLength(1);
    expect(spies.pickerValues[0]).toMatchObject({
      kind: "resume",
      index: 1,
    });
  });

  test("handlePickerSelect resumes selected session", async () => {
    const first = createSession({ id: "sess_first" });
    const second = createSession({ id: "sess_second" });
    const sessionState = createSessionState({ sessions: [first, second], activeSessionId: first.id });
    const { handlers, spies } = createPickerHandlerHarness({ sessionState, currentSession: first });

    await handlers.handlePickerSelect({ kind: "resume", items: [first, second], index: 1, scrollOffset: 0 });
    expect(sessionState.activeSessionId).toBe(second.id);
    expect(spies.currentSessions).toEqual([second]);
    expect(spies.rowsDirectSets.at(-1)).toEqual([]);
    expect(spies.pickerValues.at(-1)).toBeNull();
  });

  test("handlePickerSelect model applies selected model", async () => {
    const currentSession = createSession({ id: "sess_current", model: "gpt-5-mini" });
    const sessionState = createSessionState({ sessions: [currentSession], activeSessionId: currentSession.id });
    const { handlers, spies } = createPickerHandlerHarness({
      sessionState,
      currentSession,
      persistConfig: async () => {},
    });

    await handlers.handlePickerSelect({
      kind: "model",
      items: [
        { label: "gpt-5-mini", value: "gpt-5-mini" },
        { label: "gpt-5.2", value: "gpt-5.2" },
      ],
      filtered: [
        { label: "gpt-5-mini", value: "gpt-5-mini" },
        { label: "gpt-5.2", value: "gpt-5.2" },
      ],
      query: "",
      index: 1,
      scrollOffset: 0,
    });

    expect(spies.currentSessions.at(-1)?.model).toBe("gpt-5.2");
    expect(spies.rows.some((row) => row.content === "Changed model to gpt-5.2.")).toBe(true);
  });

  test("model change persists session", async () => {
    const currentSession = createSession({ id: "sess_current", model: "gpt-5-mini" });
    const sessionState = createSessionState({ sessions: [currentSession], activeSessionId: currentSession.id });
    const { handlers, spies } = createPickerHandlerHarness({
      sessionState,
      currentSession,
      persistConfig: async () => {},
    });

    await handlers.handlePickerSelect({
      kind: "model",
      items: [{ label: "gpt-5.2", value: "gpt-5.2" }],
      filtered: [{ label: "gpt-5.2", value: "gpt-5.2" }],
      query: "",
      index: 0,
      scrollOffset: 0,
    });

    expect(spies.persistCalls).toBe(1);
  });
});
