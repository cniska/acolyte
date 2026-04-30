import { z } from "zod";
import { messageKindSchema, roleSchema } from "./chat-contract";
import { isoDateTimeSchema } from "./datetime";
import { getSessionStore } from "./session-store";
import type { ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";

function createSessionSearchTool(input: ToolkitInput) {
  return createTool({
    id: "session-search",
    toolkit: "session",
    category: "search",
    description:
      "Search the current session's conversation history by keyword. Returns matching messages in chronological order.",
    instruction:
      "Use `session-search` to find earlier conversation turns by keyword. The last few messages are included in context automatically; older history is only available through this tool.",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("session-search"),
      results: z.array(
        z.object({
          id: z.string(),
          role: roleSchema,
          content: z.string(),
          kind: messageKindSchema,
          timestamp: isoDateTimeSchema,
        }),
      ),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "session-search", toolCallId, toolInput, async () => {
        if (!input.sessionId) return { kind: "session-search" as const, results: [] };
        const store = await getSessionStore();
        const results = await store.searchSession(input.sessionId, toolInput.query, { limit: toolInput.limit });
        return {
          kind: "session-search" as const,
          results: results.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            kind: m.kind ?? "text",
            timestamp: m.timestamp,
          })),
        };
      });
    },
  });
}

function createSessionHandoffTool(input: ToolkitInput) {
  return createTool({
    id: "session-handoff",
    toolkit: "session",
    category: "meta",
    description: "Request a handoff to a new session without mutating session state.",
    instruction:
      "Call `session-handoff` when the current session should get a summary review before starting a new session. Provide a short `reason` when helpful.",
    inputSchema: z
      .object({
        reason: z.string().min(1).optional(),
      })
      .strict(),
    outputSchema: z
      .object({
        kind: z.literal("session-handoff"),
        requested: z.literal(true),
        reason: z.string().min(1).optional(),
      })
      .strict(),
    execute: async (toolInput, toolCallId) => {
      return runTool(
        input.session,
        "session-handoff",
        toolCallId,
        toolInput,
        async () => {
          return {
            kind: "session-handoff" as const,
            requested: true as const,
            ...(toolInput.reason ? { reason: toolInput.reason } : {}),
          };
        },
        { skipStepBudget: true },
      );
    },
  });
}

export function createSessionToolkit(input: ToolkitInput) {
  return {
    sessionSearch: createSessionSearchTool(input),
    sessionHandoff: createSessionHandoffTool(input),
  };
}
