import { describe, expect, test } from "bun:test";
import {
  appendLifecycleTextDelta,
  createLifecycleTextStreamState,
  extractLifecycleSignal,
  finalizeLifecycleText,
  stripSignalLine,
} from "./lifecycle-signal";

describe("stripSignalLine", () => {
  test("returns text before the signal", () => {
    expect(stripSignalLine("Done.\n@signal done")).toBe("Done.");
  });

  test("returns empty string when only a signal is present", () => {
    expect(stripSignalLine("@signal no_op")).toBe("");
  });

  test("returns full text when no signal is present", () => {
    expect(stripSignalLine("No signal here.")).toBe("No signal here.");
  });
});

describe("extractLifecycleSignal", () => {
  test("strips a trailing signal and returns text before it", () => {
    expect(extractLifecycleSignal("Finished the requested change.\n@signal done")).toEqual({
      signal: "done",
      text: "Finished the requested change.",
    });
  });

  test("strips the signal line and preserves text on both sides", () => {
    expect(extractLifecycleSignal("Hello!\n@signal done\nExtra.")).toEqual({
      signal: "done",
      text: "Hello!\nExtra.",
    });
    expect(extractLifecycleSignal("Hello.\n@signal done\n")).toEqual({ signal: "done", text: "Hello." });
  });

  test("strips a leading signal and returns empty string", () => {
    expect(extractLifecycleSignal("@signal no_op")).toEqual({ signal: "no_op", text: "" });
    expect(extractLifecycleSignal("@signal done\n")).toEqual({ signal: "done", text: "" });
  });

  test("leaves plain text unchanged when no signal is present", () => {
    expect(extractLifecycleSignal("Finished the requested change.")).toEqual({
      text: "Finished the requested change.",
    });
  });
});

describe("lifecycle text streaming", () => {
  test("streams plain text incrementally", () => {
    const state = createLifecycleTextStreamState();
    expect(appendLifecycleTextDelta(state, "Hello")).toBe("Hello");
    expect(appendLifecycleTextDelta(state, " world")).toBe(" world");
    expect(finalizeLifecycleText(state)).toEqual({ text: "" });
  });

  test("buffers and suppresses a trailing signal", () => {
    const state = createLifecycleTextStreamState();
    expect(appendLifecycleTextDelta(state, "Done.")).toBe("Done.");
    expect(appendLifecycleTextDelta(state, "\n@sig")).toBe("");
    expect(appendLifecycleTextDelta(state, "nal done")).toBe("");
    expect(finalizeLifecycleText(state)).toEqual({ signal: "done", text: "" });
  });

  test("preserves text after the signal line", () => {
    const state = createLifecycleTextStreamState();
    expect(appendLifecycleTextDelta(state, "Hello!")).toBe("Hello!");
    expect(appendLifecycleTextDelta(state, "\n@sig")).toBe("");
    expect(appendLifecycleTextDelta(state, "nal done\nExtra.")).toBe("Extra.");
    expect(finalizeLifecycleText(state)).toEqual({ signal: "done", text: "" });
  });

  test("suppresses a leading signal", () => {
    const state = createLifecycleTextStreamState();
    expect(appendLifecycleTextDelta(state, "@sig")).toBe("");
    expect(appendLifecycleTextDelta(state, "nal no_op")).toBe("");
    expect(finalizeLifecycleText(state)).toEqual({ signal: "no_op", text: "" });
  });

  test("suppresses signal split across many deltas and all text after it", () => {
    const state = createLifecycleTextStreamState();
    expect(appendLifecycleTextDelta(state, "Hi there!")).toBe("Hi there!");
    expect(appendLifecycleTextDelta(state, "\n@")).toBe("");
    expect(appendLifecycleTextDelta(state, "signal")).toBe("");
    expect(appendLifecycleTextDelta(state, " done")).toBe("");
    expect(appendLifecycleTextDelta(state, "\n")).toBe("");
    expect(appendLifecycleTextDelta(state, "After.")).toBe("");
    expect(finalizeLifecycleText(state)).toEqual({ signal: "done", text: "" });
  });

  test("treats invalid signal-looking text as normal output", () => {
    const state = createLifecycleTextStreamState();
    expect(appendLifecycleTextDelta(state, "@signal maybe\nHello")).toBe("@signal maybe\nHello");
    expect(finalizeLifecycleText(state)).toEqual({ text: "" });
  });

  test("emits buffered text at finalize when no signal arrived", () => {
    const state = createLifecycleTextStreamState();
    expect(appendLifecycleTextDelta(state, "Hello\n@sig")).toBe("Hello");
    // Stream ends without completing the signal — emit the buffered partial as text.
    // The preceding \n is included in the buffer since it's part of the potential signal delimiter.
    expect(finalizeLifecycleText(state)).toEqual({ text: "\n@sig" });
  });

  test("strips signal regardless of where the delta boundary falls", () => {
    const signal = "\n@signal done";
    for (let split = 1; split < signal.length; split++) {
      const state = createLifecycleTextStreamState();
      const left = `Text.${signal.slice(0, split)}`;
      const right = signal.slice(split);
      let visible = appendLifecycleTextDelta(state, left);
      visible += appendLifecycleTextDelta(state, right);
      const fin = finalizeLifecycleText(state);
      expect(fin.signal).toBe("done");
      expect((visible + fin.text).trim()).toBe("Text.");
    }
  });

  test("signal without trailing newline is caught at finalization", () => {
    const state = createLifecycleTextStreamState();
    appendLifecycleTextDelta(state, "Result.\n@signal done");
    const fin = finalizeLifecycleText(state);
    expect(fin.signal).toBe("done");
    expect(fin.text).toBe("");
  });
});
