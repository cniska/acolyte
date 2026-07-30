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
      "Search the current session's conversation history by keyword. Returns matching messages in chronological order. The last few messages are already in context; anything older — a prior decision, an earlier error, a file discussed before — is reachable only here, so search for it rather than asking the user to repeat themselves.",
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

export function createSessionToolkit(input: ToolkitInput) {
  return {
    sessionSearch: createSessionSearchTool(input),
  };
}
