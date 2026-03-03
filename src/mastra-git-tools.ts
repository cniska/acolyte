import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { appConfig } from "./app-config";
import type { GitToolkit } from "./git-toolkit";
import { compactToolOutput } from "./tool-output";
import type { ToolName } from "./tool-names";
import type { SessionContext } from "./tool-guards";

type ToolOutputListener = (event: { toolName: ToolName; message: string; toolCallId?: string }) => void;

type GuardedExecute = <T>(
  toolId: ToolName,
  args: Record<string, unknown>,
  session: SessionContext,
  task: () => Promise<T>,
) => Promise<T>;

type WithToolError = <T>(toolId: ToolName, task: () => Promise<T>) => Promise<T>;

type EmitHeadTailLines = (
  toolName: ToolName,
  rawText: string,
  onToolOutput: ToolOutputListener | undefined,
  toolCallId: string,
  options?: { headRows?: number; tailRows?: number; trimStart?: boolean },
) => void;

export function createMastraGitTools(options: {
  git: GitToolkit;
  session: SessionContext;
  onToolOutput?: ToolOutputListener;
  guardedExecute: GuardedExecute;
  withToolError: WithToolError;
  streamCallId: (toolName: ToolName) => string;
  emitHeadTailLines: EmitHeadTailLines;
  stripGitShowMetadataForPreview: (rawText: string) => string;
}) {
  const {
    git,
    session,
    onToolOutput,
    guardedExecute,
    withToolError,
    streamCallId,
    emitHeadTailLines,
    stripGitShowMetadataForPreview,
  } = options;

  return {
    gitStatus: createTool({
      id: "git-status",
      description: "Show working tree status (short format with branch) for the current repository.",
      inputSchema: z.object({}),
      execute: async () => {
        return withToolError("git-status", () =>
          guardedExecute("git-status", {}, session, async () => {
            const toolCallId = streamCallId("git-status");
            const rawStatus = await git.statusShort();
            emitHeadTailLines("git-status", rawStatus, onToolOutput, toolCallId, { trimStart: true });
            const result = compactToolOutput(rawStatus, appConfig.agent.toolOutputBudget.gitStatus);
            return { result };
          }),
        );
      },
    }),
    gitDiff: createTool({
      id: "git-diff",
      description: "Show unstaged changes (unified diff) for the repository or a specific file path.",
      inputSchema: z.object({
        path: z.string().optional(),
        contextLines: z.number().int().min(0).max(20).optional(),
      }),
      execute: async (input) => {
        return withToolError("git-diff", () =>
          guardedExecute("git-diff", input as Record<string, unknown>, session, async () => {
            const toolCallId = streamCallId("git-diff");
            const rawDiff = await git.diff({ path: input.path, contextLines: input.contextLines ?? 3 });
            emitHeadTailLines("git-diff", rawDiff, onToolOutput, toolCallId, { headRows: 4, tailRows: 4 });
            const result = compactToolOutput(rawDiff, appConfig.agent.toolOutputBudget.gitDiff);
            return { result };
          }),
        );
      },
    }),
    gitLog: createTool({
      id: "git-log",
      description: "Show recent commits in compact one-line form (optionally scoped to a file/path).",
      inputSchema: z.object({
        path: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async (input) => {
        return withToolError("git-log", () =>
          guardedExecute("git-log", input as Record<string, unknown>, session, async () => {
            const toolCallId = streamCallId("git-log");
            const rawLog = await git.log({ path: input.path, limit: input.limit });
            emitHeadTailLines("git-log", rawLog, onToolOutput, toolCallId, { trimStart: true });
            const result = compactToolOutput(rawLog, appConfig.agent.toolOutputBudget.gitStatus);
            return { result };
          }),
        );
      },
    }),
    gitShow: createTool({
      id: "git-show",
      description: "Show commit details and patch for a ref (default HEAD), optionally scoped to a path.",
      inputSchema: z.object({
        ref: z.string().optional(),
        path: z.string().optional(),
        contextLines: z.number().int().min(0).max(20).optional(),
      }),
      execute: async (input) => {
        return withToolError("git-show", () =>
          guardedExecute("git-show", input as Record<string, unknown>, session, async () => {
            const toolCallId = streamCallId("git-show");
            const rawShow = await git.show({
              ref: input.ref,
              path: input.path,
              contextLines: input.contextLines ?? 3,
            });
            emitHeadTailLines("git-show", stripGitShowMetadataForPreview(rawShow), onToolOutput, toolCallId, {
              headRows: 4,
              tailRows: 4,
            });
            const result = compactToolOutput(rawShow, appConfig.agent.toolOutputBudget.gitDiff);
            return { result };
          }),
        );
      },
    }),
  };
}
