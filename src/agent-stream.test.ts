import { describe, expect, test } from "bun:test";
import { appendLifecycleTextDelta, extractLifecycleSignal, finalizeLifecycleText } from "./lifecycle-signal";

describe("extractLifecycleSignal", () => {
  test("extracts done signal from the first line", () => {
    expect(extractLifecycleSignal("@signal done\nFinished the requested change.")).toEqual({
      signal: "done",
      text: "Finished the requested change.",
    });
  });

  test("extracts no_op signal from the first line", () => {
    expect(extractLifecycleSignal("@signal no_op\nNo changes were needed.")).toEqual({
      signal: "no_op",
      text: "No changes were needed.",
    });
  });

  test("leaves plain text unchanged when no signal is present", () => {
    expect(extractLifecycleSignal("Finished the requested change.")).toEqual({
      text: "Finished the requested change.",
    });
  });
});

describe("lifecycle text streaming", () => {
  test("streams plain text incrementally", () => {
    const state = { pending: "", resolved: false } as const;
    const mutableState = { ...state };

    expect(appendLifecycleTextDelta(mutableState, "Hello")).toBe("Hello");
    expect(appendLifecycleTextDelta(mutableState, " world")).toBe(" world");
    expect(finalizeLifecycleText(mutableState)).toEqual({ text: "" });
  });

  test("strips a leading signal and streams following text", () => {
    const state = { pending: "", resolved: false };

    expect(appendLifecycleTextDelta(state, "@sig")).toBe("");
    expect(appendLifecycleTextDelta(state, "nal done\nFin")).toBe("Fin");
    expect(appendLifecycleTextDelta(state, "ished.")).toBe("ished.");
    expect(finalizeLifecycleText(state)).toEqual({ signal: "done", text: "" });
  });

  test("strips a signal that appears after text", () => {
    expect(extractLifecycleSignal("Hello.\n@signal done\n")).toEqual({ signal: "done", text: "Hello." });
    expect(extractLifecycleSignal("Hello.\n@signal done")).toEqual({ signal: "done", text: "Hello." });
  });

  test("treats invalid signal-looking text as normal output", () => {
    const state = { pending: "", resolved: false };

    expect(appendLifecycleTextDelta(state, "@signal maybe\nHello")).toBe("@signal maybe\nHello");
    expect(finalizeLifecycleText(state)).toEqual({ text: "" });
  });
});
