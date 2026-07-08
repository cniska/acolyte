import { describe, expect, test } from "bun:test";
import { captureCliOutput } from "./cli-test-harness";
import { handlePrompt } from "./cli-prompt";
import type { Client, StreamEvent } from "./client-contract";
import type { Session } from "./session-contract";

// Byte-for-byte safety net for the output-path fold: run mode's exact stdout for
// representative event streams, frozen against the pre-fold renderer. The projector
// that replaces cli-prompt's hand-rolled renderer must reproduce these verbatim; any
// diff is a deliberate behavior change, not an accident. Captured output is ANSI-
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

function client(
  events: StreamEvent[],
  reply: { state: "done" | "awaiting-input"; output: string; error?: string },
): Client {
  return {
    replyStream: async (input) => {
      for (const event of events) input.onEvent(event);
      return { ...reply, model: "gpt-5-mini", toolCalls: reply.state === "done" ? ["file-read"] : [] };
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
    const out = await capture(
      "hi",
      client([{ type: "text-delta", text: "Hello there." }], { state: "done", output: "Hello there." }),
    );
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
    const out = await capture("check config", client(events, { state: "done", output: "Updated the config." }));
    expect(out).toBe(
      "❯ check config\n• Let me check the config.• tool.file_read.header src/config.ts\n• Steps (1/2)\n  ● read\n  ○ edit\ntrace sink is dark",
    );
  });

  test("blocking error surfaces after streamed text", async () => {
    const out = await capture(
      "fix",
      client([{ type: "text-delta", text: "Trying the edit." }], {
        state: "awaiting-input",
        output: "",
        error: "Cannot finish yet: validation missing",
      }),
    );
    expect(out).toBe("❯ fix\n• Trying the edit.Cannot finish yet: validation missing");
  });
});
