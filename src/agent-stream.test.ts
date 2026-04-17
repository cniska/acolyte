import { describe, expect, test } from "bun:test";
import type { LanguageModelV3Message } from "@ai-sdk/provider";
import { COMPACTED_OUTPUT, compactPriorToolResults, truncateToolResult } from "./agent-stream";
import { MAX_TOOL_RESULT_CHARS, TOOL_RESULT_MAX_CHARS } from "./lifecycle-constants";
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

  test("returns text before an inline signal", () => {
    expect(stripSignalLine("Build skill activated. @signal done")).toBe("Build skill activated.");
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

  test("detects an inline signal preceded by a space", () => {
    expect(extractLifecycleSignal("Build skill activated. @signal done")).toEqual({
      signal: "done",
      text: "Build skill activated.",
    });
    expect(extractLifecycleSignal("All good. @signal no_op\n")).toEqual({
      signal: "no_op",
      text: "All good.",
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

  test("detects and strips an inline signal during streaming", () => {
    const state = createLifecycleTextStreamState();
    expect(appendLifecycleTextDelta(state, "Build skill activated. @signal done")).toBe("Build skill activated.");
    expect(finalizeLifecycleText(state)).toEqual({ signal: "done", text: "" });
  });

  test("strips inline signal regardless of delta boundary", () => {
    const signal = " @signal done";
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

  test("last well-formed signal wins when multiple appear inline", () => {
    const state = createLifecycleTextStreamState();
    // Only the final signal satisfies the end-of-line/string anchor
    expect(appendLifecycleTextDelta(state, "Done. @signal done Also. @signal blocked")).toBe("Done. Also.");
    expect(finalizeLifecycleText(state)).toEqual({ signal: "blocked", text: "" });
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

describe("compactPriorToolResults", () => {
  function toolMsg(results: Array<{ id: string; name: string; value: string }>): LanguageModelV3Message {
    return {
      role: "tool",
      content: results.map((r) => ({
        type: "tool-result" as const,
        toolCallId: r.id,
        toolName: r.name,
        output: { type: "text" as const, value: r.value },
      })),
    };
  }

  test("replaces tool result output with compact marker", () => {
    const messages: LanguageModelV3Message[] = [
      { role: "system", content: "you are helpful" },
      { role: "user", content: [{ type: "text", text: "search for foo" }] },
      toolMsg([{ id: "tc_1", name: "file-search", value: "hit:\n".repeat(500) }]),
    ];
    compactPriorToolResults(messages);
    const tool = messages[2];
    expect(tool.role).toBe("tool");
    if (tool.role !== "tool") throw new Error("unexpected");
    const part = tool.content[0];
    expect(part.type).toBe("tool-result");
    if (part.type !== "tool-result") throw new Error("unexpected");
    expect(part.output).toEqual(COMPACTED_OUTPUT);
    expect(part.toolCallId).toBe("tc_1");
    expect(part.toolName).toBe("file-search");
  });

  test("skips non-tool messages", () => {
    const systemContent = "you are helpful";
    const messages: LanguageModelV3Message[] = [
      { role: "system", content: systemContent },
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];
    compactPriorToolResults(messages);
    expect(messages[0]).toEqual({ role: "system", content: systemContent });
    expect(messages[1]).toEqual({ role: "user", content: [{ type: "text", text: "hello" }] });
  });

  test("compacts multiple tool messages", () => {
    const messages: LanguageModelV3Message[] = [
      { role: "system", content: "sys" },
      toolMsg([{ id: "tc_1", name: "file-search", value: "hit1" }]),
      toolMsg([{ id: "tc_2", name: "file-search", value: "hit2" }]),
    ];
    compactPriorToolResults(messages);
    for (const msg of messages.filter((m) => m.role === "tool")) {
      if (msg.role !== "tool") continue;
      for (const part of msg.content) {
        if (part.type !== "tool-result") continue;
        expect(part.output).toEqual(COMPACTED_OUTPUT);
      }
    }
  });

  test("preserves file-read results across compaction", () => {
    const fileContent = "File: src/foo.ts\n1: const x = 1;\n2: const y = 2;\n";
    const messages: LanguageModelV3Message[] = [
      toolMsg([{ id: "tc_1", name: "file-read", value: fileContent }]),
      toolMsg([{ id: "tc_2", name: "file-search", value: "hits" }]),
    ];
    compactPriorToolResults(messages);
    if (messages[0].role !== "tool") throw new Error("unexpected");
    const readPart = messages[0].content[0];
    if (readPart.type !== "tool-result") throw new Error("unexpected");
    expect(readPart.output).toEqual({ type: "text", value: fileContent });
    if (messages[1].role !== "tool") throw new Error("unexpected");
    const searchPart = messages[1].content[0];
    if (searchPart.type !== "tool-result") throw new Error("unexpected");
    expect(searchPart.output).toEqual(COMPACTED_OUTPUT);
  });

  test("compacts multiple results within a single tool message", () => {
    const messages: LanguageModelV3Message[] = [
      toolMsg([
        { id: "tc_1", name: "file-search", value: "content1" },
        { id: "tc_2", name: "shell-exec", value: "output2" },
      ]),
    ];
    compactPriorToolResults(messages);
    if (messages[0].role !== "tool") throw new Error("unexpected");
    expect(messages[0].content).toHaveLength(2);
    for (const part of messages[0].content) {
      if (part.type !== "tool-result") continue;
      expect(part.output).toEqual(COMPACTED_OUTPUT);
    }
  });

  test("is idempotent", () => {
    const messages: LanguageModelV3Message[] = [toolMsg([{ id: "tc_1", name: "file-search", value: "content" }])];
    compactPriorToolResults(messages);
    compactPriorToolResults(messages);
    if (messages[0].role !== "tool") throw new Error("unexpected");
    const part = messages[0].content[0];
    if (part.type !== "tool-result") throw new Error("unexpected");
    expect(part.output).toEqual(COMPACTED_OUTPUT);
  });
});

describe("truncateToolResult", () => {
  test("returns raw unchanged when under the category cap", () => {
    const raw = "small result";
    expect(truncateToolResult("read", raw)).toBe(raw);
  });

  test("truncates large search results to the search cap", () => {
    const raw = "x".repeat(TOOL_RESULT_MAX_CHARS.search * 3);
    const out = truncateToolResult("search", raw);
    expect(out.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS.search);
    expect(out).toContain("chars truncated");
  });

  test("gives read results a larger budget than search", () => {
    const raw = "x".repeat(TOOL_RESULT_MAX_CHARS.read * 2);
    const readOut = truncateToolResult("read", raw);
    const searchOut = truncateToolResult("search", raw);
    expect(readOut.length).toBeGreaterThan(searchOut.length);
    expect(readOut.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS.read);
  });

  test("uses every defined category cap", () => {
    const categories: Array<keyof typeof TOOL_RESULT_MAX_CHARS> = [
      "search",
      "read",
      "write",
      "execute",
      "network",
      "meta",
    ];
    for (const category of categories) {
      const cap = TOOL_RESULT_MAX_CHARS[category];
      const raw = "x".repeat(cap * 2);
      const out = truncateToolResult(category, raw);
      expect(out.length).toBeLessThanOrEqual(cap);
    }
  });

  test("falls back to the default cap when category is undefined", () => {
    const raw = "x".repeat(MAX_TOOL_RESULT_CHARS * 2);
    const out = truncateToolResult(undefined, raw);
    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
  });
});
