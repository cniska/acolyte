import { describe, expect, test } from "bun:test";
import { handlePrompt } from "./cli-prompt";
import { captureCliOutput } from "./cli-test-harness";
import type { Client, StreamEvent } from "./client-contract";
import type { Session } from "./session-contract";

// Golden test. Freeze the exact stdout of run mode against known-good code, then assert
// every future run reproduces it byte for byte. The purpose is change detection: refactor
// the renderer and these pass, so the output is provably unchanged; a real diff points at
// exactly what moved. When a change is intentional, update the frozen string in the same
// commit, so the diff becomes the review surface.
//
// Each test freezes run mode's output for one event stream. Captured output is ANSI-
// stripped and trimmed (see captureCliOutput), so this locks structure, not color.

function session(): Session {
  return {
    id: "sess_golden",
    createdAt: "2026-03-05T10:00:00.000Z",
    updatedAt: "2026-03-05T10:00:00.000Z",
    model: "gpt-5-mini",
    title: "New Session",
    messages: [],
    tokenUsage: [],
  };
}

function client(events: StreamEvent[], reply: { output: string; error?: string }): Client {
  return {
    replyStream: async (input) => {
      for (const event of events) input.onEvent(event);
      return {
        ...reply,
        model: "gpt-5-mini",
        toolCalls: reply.error ? [] : ["file-read"],
        outputStreamed: events.some((event) => event.type === "text-delta" && event.text.trim().length > 0),
      };
    },
    status: async () => ({}),
    taskStatus: async () => null,
  };
}

function capture(prompt: string, c: Client): Promise<string> {
  return captureCliOutput(async () => {
    await handlePrompt(prompt, session(), c);
  });
}

describe("cli-prompt golden output (output-path fold safety net)", () => {
  test("streamed answer", async () => {
    const out = await capture("hi", client([{ type: "text-delta", text: "Hello there." }], { output: "Hello there." }));
    expect(out).toBe("❯ hi\n• Hello there.");
  });

  test("tool output, checklist, and notice", async () => {
    const events: StreamEvent[] = [
      { type: "text-delta", text: "Let me check the config." },
      {
        type: "tool-output",
        toolCallId: "c1",
        toolName: "file-read",
        content: { kind: "tool-header", labelKey: "tool.file_read.header", detail: "src/config.ts" },
      },
      { type: "tool-result", toolCallId: "c1", toolName: "file-read" },
      {
        type: "checklist",
        groupId: "g1",
        groupTitle: "Steps",
        items: [
          { id: "s1", label: "read", status: "done", order: 0 },
          { id: "s2", label: "edit", status: "pending", order: 1 },
        ],
      },
      { type: "notice", level: "warn", message: "trace sink is dark" },
    ];
    const out = await capture("check config", client(events, { output: "Updated the config." }));
    // The final answer ("Updated the config.") diverges from the streamed preview ("Let
    // me check the config.") and now appears in full — previously it was dropped.
    expect(out).toBe(
      "❯ check config\n• Let me check the config.• tool.file_read.header src/config.ts\n• Steps (1/2)\n  ● read\n  ○ edit\ntrace sink is dark\n\n\n\n• Updated the config.",
    );
  });

  test("blocking error surfaces after streamed text", async () => {
    const out = await capture(
      "fix",
      client([{ type: "text-delta", text: "Trying the edit." }], {
        output: "",
        error: "Cannot finish yet: validation missing",
      }),
    );
    expect(out).toBe("❯ fix\n• Trying the edit.Cannot finish yet: validation missing");
  });

  test("a lone detail-less tool header prints nothing until it has content", async () => {
    const out = await capture(
      "search",
      client(
        [
          {
            type: "tool-output",
            toolCallId: "c1",
            toolName: "memory-search",
            content: { kind: "tool-header", labelKey: "tool.memory_search.header" },
          },
        ],
        { output: "Done." },
      ),
    );
    expect(out).toBe("❯ search\n\n• Done.");
  });

  test("checklist reprints on each progress update", async () => {
    const items = (readDone: boolean) => [
      { id: "s1", label: "read", status: readDone ? ("done" as const) : ("pending" as const), order: 0 },
      { id: "s2", label: "edit", status: "pending" as const, order: 1 },
    ];
    const out = await capture(
      "run",
      client(
        [
          { type: "checklist", groupId: "g1", groupTitle: "Steps", items: items(false) },
          { type: "checklist", groupId: "g1", groupTitle: "Steps", items: items(true) },
        ],
        { output: "Done." },
      ),
    );
    expect(out).toBe("❯ run\n• Steps (0/2)\n  ○ read\n  ○ edit\n• Steps (1/2)\n  ● read\n  ○ edit\n\n\n• Done.");
  });
});
