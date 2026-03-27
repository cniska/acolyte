import { describe, expect, test } from "bun:test";
import { createMessage } from "./chat-session";
import { handlePrompt } from "./cli-prompt";
import type { Client, StreamEvent } from "./client-contract";
import type { Session } from "./session-contract";
import type { ToolOutputPart } from "./tool-output-content";

function createTestSession(): Session {
  return {
    id: "sess_test0001",
    createdAt: "2026-03-05T10:00:00.000Z",
    updatedAt: "2026-03-05T10:00:00.000Z",
    model: "gpt-5-mini",
    title: "New Session",
    messages: [],
    tokenUsage: [],
  };
}

function createStreamingClient(events: StreamEvent[]): Client {
  return {
    replyStream: async (_input, options) => {
      for (const event of events) options.onEvent(event);
      return { state: "done" as const, output: "done", model: "gpt-5-mini", toolCalls: ["code-edit"] };
    },
    status: async () => ({}),
    taskStatus: async () => null,
  };
}

describe("cli-prompt", () => {
  test("createMessage creates a timestamped chat message", () => {
    const message = createMessage("user", "hello");
    expect(message.id.startsWith("msg_")).toBe(true);
    expect(message.role).toBe("user");
    expect(message.content).toBe("hello");
    expect(Number.isNaN(Date.parse(message.timestamp))).toBe(false);
  });

  test("handlePrompt marks assistant message as tool_payload when tools were used", async () => {
    const session = createTestSession();
    const client: Client = {
      replyStream: async () => ({
        state: "done" as const,
        output: "done",
        model: "gpt-5-mini",
        toolCalls: ["file-read"],
      }),
      status: async () => ({}),
      taskStatus: async () => null,
    };

    const ok = await handlePrompt("hello", session, client);
    expect(ok).toBe(true);
    expect(session.messages[session.messages.length - 1]?.kind).toBe("tool_payload");
  });

  test("checklist events print header and items", async () => {
    const printed: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      printed.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const events: StreamEvent[] = [
        {
          type: "checklist",
          groupId: "grp_1",
          groupTitle: "Build pipeline",
          items: [
            { id: "s1", label: "lint", status: "done", order: 0 },
            { id: "s2", label: "test", status: "in_progress", order: 1 },
            { id: "s3", label: "deploy", status: "pending", order: 2 },
          ],
        },
      ];

      const session = createTestSession();
      const client = createStreamingClient(events);
      await handlePrompt("run pipeline", session, client);

      const output = printed.join("");
      expect(output).toContain("Build pipeline (1/3)");
      expect(output).toContain("● lint");
      expect(output).toContain("◐ test");
      expect(output).toContain("○ deploy");
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("tool-output events with growing numWidth do not reprint earlier diffs", async () => {
    const printed: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      printed.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const callId = "call_1";
      const toolName = "code-edit";

      const header: ToolOutputPart = {
        kind: "edit-header",
        labelKey: "tool.edit_code.header",
        path: "src/foo.ts",
        files: 1,
        added: 2,
        removed: 1,
      };

      // First diff: line 4, numWidth = 1
      const diff1: ToolOutputPart = { kind: "diff", marker: "context", lineNumber: 4, text: "const a = 1;" };
      // Second diff: line 5, numWidth still 1
      const diff2: ToolOutputPart = { kind: "diff", marker: "add", lineNumber: 5, text: "const b = 2;" };
      // Third diff at line 100 — numWidth jumps from 1 to 3, changing all earlier renders
      const diff3: ToolOutputPart = { kind: "diff", marker: "add", lineNumber: 100, text: "const c = 3;" };

      const events: StreamEvent[] = [
        { type: "tool-output", toolCallId: callId, toolName, content: header },
        { type: "tool-output", toolCallId: callId, toolName, content: diff1 },
        { type: "tool-output", toolCallId: callId, toolName, content: diff2 },
        { type: "tool-output", toolCallId: callId, toolName, content: diff3 },
      ];

      const session = createTestSession();
      const client = createStreamingClient(events);
      await handlePrompt("rename foo", session, client);

      const output = printed.join("");
      // The edit-header text should appear only once
      const headerMatches = output.match(/src\/foo\.ts/g) ?? [];
      expect(headerMatches.length).toBe(1);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
