import { z } from "zod";
import { createTool, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { listUndoCheckpoints, restoreUndoCheckpoint } from "./undo-checkpoints";

function createUndoListTool(input: ToolkitInput) {
  return createTool({
    id: "undo-list",
    toolkit: "undo",
    category: "meta",
    description: "List recent undo checkpoints for the current session (if enabled).",
    instruction:
      "Use `undo-list` to discover recent undo checkpoints. If undo checkpoints are disabled, it will return an empty list.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("undo-list"),
      sessionId: z.string().min(1),
      entries: z.array(
        z.object({
          id: z.string().min(1),
          seq: z.number().int().min(1),
          toolCallId: z.string().min(1),
          toolId: z.string().min(1),
          createdAt: z.string().min(1),
          paths: z.array(z.string().min(1)),
        }),
      ),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "undo-list", toolCallId, toolInput, async () => {
        const sessionId = input.sessionId ?? "";
        if (!sessionId || !input.session.featureFlags?.undoCheckpoints) {
          return {
            kind: "undo-list" as const,
            sessionId: sessionId || "unknown",
            entries: [],
            output: "Undo checkpoints disabled.",
          };
        }
        const entries = await listUndoCheckpoints({
          workspace: input.workspace,
          sessionId,
          limit: toolInput.limit ?? 20,
        });
        const lines = entries.map((e) => `${e.id} ${e.toolId} ${e.paths.join(", ")}`);
        const output = lines.length > 0 ? lines.join("\n") : "No undo checkpoints.";
        return { kind: "undo-list" as const, sessionId, entries, output };
      });
    },
  });
}

function createUndoRestoreTool(input: ToolkitInput) {
  return createTool({
    id: "undo-restore",
    toolkit: "undo",
    category: "write",
    description: "Restore files to the pre-write state captured in an undo checkpoint.",
    instruction: [
      "Use `undo-restore` to revert a specific checkpoint.",
      "You must pass `checkpointId` and the list of `paths` from `undo-list` so cache invalidation can be targeted.",
      "If there are conflicts, do not retry blindly; inspect diffs and choose a different recovery path.",
    ].join(" "),
    inputSchema: z.object({
      checkpointId: z.string().min(1),
      paths: z.array(z.string().min(1)).min(1),
    }),
    outputSchema: z.object({
      kind: z.literal("undo-restore"),
      checkpointId: z.string().min(1),
      restored: z.array(z.string().min(1)),
      conflicts: z.array(z.object({ path: z.string().min(1), reason: z.string().min(1) })),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "undo-restore", toolCallId, toolInput, async () => {
        const sessionId = input.sessionId ?? "";
        if (!sessionId || !input.session.featureFlags?.undoCheckpoints) {
          return {
            kind: "undo-restore" as const,
            checkpointId: toolInput.checkpointId,
            restored: [],
            conflicts: [],
            output: "Undo checkpoints disabled.",
          };
        }
        const result = await restoreUndoCheckpoint({
          workspace: input.workspace,
          sessionId,
          checkpointId: toolInput.checkpointId,
          paths: toolInput.paths,
        });
        const output =
          result.conflicts.length > 0
            ? `Conflicts:\n${result.conflicts.map((c) => `- ${c.path}: ${c.reason}`).join("\n")}`
            : `Restored ${result.restored.length} file(s).`;
        return {
          kind: "undo-restore" as const,
          checkpointId: toolInput.checkpointId,
          restored: result.restored,
          conflicts: result.conflicts.map((c) => ({ path: c.path, reason: c.reason })),
          output,
        };
      });
    },
  });
}

export function createUndoToolkit(input: ToolkitInput) {
  return {
    listUndo: createUndoListTool(input),
    restoreUndo: createUndoRestoreTool(input),
  };
}
