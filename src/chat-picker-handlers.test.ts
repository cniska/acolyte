import { describe, expect, test } from "bun:test";
import { createPickerHandlerHarness, createSession, createStore } from "./test-utils";

describe("chat picker handlers", () => {
  test("openResumePanel shows fallback when no sessions exist", () => {
    const store = createStore({ sessions: [] });
    const { handlers, spies } = createPickerHandlerHarness({ store });

    handlers.openResumePanel();
    expect(spies.rows.at(-1)?.content).toBe("No saved sessions.");
    expect(spies.pickerValues).toEqual([]);
  });

  test("openResumePanel opens picker and selects active session", () => {
    const first = createSession({ id: "sess_first" });
    const second = createSession({ id: "sess_second" });
    const store = createStore({ sessions: [first, second], activeSessionId: second.id });
    const { handlers, spies } = createPickerHandlerHarness({ store, currentSession: first });

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
    const store = createStore({ sessions: [first, second], activeSessionId: first.id });
    const { handlers, spies } = createPickerHandlerHarness({ store, currentSession: first });

    await handlers.handlePickerSelect({ kind: "resume", items: [first, second], index: 1, scrollOffset: 0 });
    expect(store.activeSessionId).toBe(second.id);
    expect(spies.currentSessions).toEqual([second]);
    expect(spies.rowsDirectSets.at(-1)).toEqual([]);
    expect(spies.pickerValues.at(-1)).toBeNull();
  });

  test("handlePickerSelect model applies selected model", async () => {
    const currentSession = createSession({ id: "sess_current", model: "gpt-5-mini" });
    const store = createStore({ sessions: [currentSession], activeSessionId: currentSession.id });
    const { handlers, spies } = createPickerHandlerHarness({
      store,
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
});
