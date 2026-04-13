import { describe, expect, test } from "bun:test";
import {
  appendLifecycleTextDelta,
  createLifecycleTextStreamState,
  extractLifecycleSignal,
  finalizeLifecycleText,
} from "./lifecycle-signal";

describe("extractLifecycleSignal", () => {
  test("strips a trailing signal and returns text before it", () => {
    expect(extractLifecycleSignal("Finished the requested change.\n@signal done")).toEqual({
      signal: "done",
      text: "Finished the requested change.",
    });
  });

  test("strips the signal line and suppresses text after it", () => {
    expect(extractLifecycleSignal("Hello!\n@signal done\nExtra.")).toEqual({
      signal: "done",
      text: "Hello!",
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

  test("suppresses text after the signal line", () => {
    const state = createLifecycleTextStreamState();
    expect(appendLifecycleTextDelta(state, "Hello!")).toBe("Hello!");
    expect(appendLifecycleTextDelta(state, "\n@sig")).toBe("");
    expect(appendLifecycleTextDelta(state, "nal done\nExtra.")).toBe("");
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

  test("mid-line @signal is not stripped", () => {
    const state = createLifecycleTextStreamState();
    const visible = appendLifecycleTextDelta(state, "see @signal done for details");
    expect(visible).toContain("@signal done");
    expect(finalizeLifecycleText(state).signal).toBeUndefined();
  });

  test("empty deltas do not break signal detection", () => {
    const state = createLifecycleTextStreamState();
    appendLifecycleTextDelta(state, "Done.");
    appendLifecycleTextDelta(state, "");
    appendLifecycleTextDelta(state, "\n@signal");
    appendLifecycleTextDelta(state, "");
    appendLifecycleTextDelta(state, " done");
    const fin = finalizeLifecycleText(state);
    expect(fin.signal).toBe("done");
  });

  test("only the first signal is consumed", () => {
    const state = createLifecycleTextStreamState();
    appendLifecycleTextDelta(state, "A\n@signal done\nB\n@signal blocked");
    const fin = finalizeLifecycleText(state);
    expect(fin.signal).toBe("done");
  });

  test("signal with extra whitespace before newline", () => {
    const state = createLifecycleTextStreamState();
    appendLifecycleTextDelta(state, "Done.\n@signal done  ");
    const fin = finalizeLifecycleText(state);
    expect(fin.signal).toBe("done");
  });

  test("partial signal prefix abandoned at finalize does not leak signal keyword", () => {
    const state = createLifecycleTextStreamState();
    appendLifecycleTextDelta(state, "Text\n@signal ");
    // Stream ends with incomplete signal — no valid signal name follows.
    const fin = finalizeLifecycleText(state);
    expect(fin.signal).toBeUndefined();
    // The partial text is emitted since it's not a valid signal.
    expect(fin.text).toContain("@signal");
  });
});
