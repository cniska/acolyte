import { resolve } from "node:path";
import { appConfig } from "./app-config";
import {
  type ToolkitInput,
  createCoreBaseToolkit,
  createCoreWriteToolkit,
  emitHeadTailLines,
  streamCallId,
  stripGitShowMetadataForPreview,
  webSearchStreamRows,
  withToolError,
} from "./core-toolkit";
import { createGitOps, createGitToolkit } from "./git-toolkit";
import type { ToolDefinition } from "./tool-contract";
import { createSessionContext, type SessionContext } from "./tool-guards";
import type { ToolName } from "./tool-names";
import type { ToolOutputListener } from "./tool-output-format";

type ToolkitMode = "read" | "write";

// biome-ignore lint/suspicious/noExplicitAny: ToolDefinition variance requires any here
type ToolkitEntries = Record<string, ToolDefinition<any>>;

type CoreBaseToolkitEntries = ReturnType<typeof createCoreBaseToolkit>;
type CoreWriteToolkitEntries = ReturnType<typeof createCoreWriteToolkit>;
type GitToolkitEntries = ReturnType<typeof createGitToolkit>;
type RegisteredToolkitEntries = CoreBaseToolkitEntries & CoreWriteToolkitEntries & GitToolkitEntries;

export type Toolset = {
  [Key in keyof RegisteredToolkitEntries]: RegisteredToolkitEntries[Key];
};

export const TOOLKIT_REGISTRY: {
  id: string;
  appliesTo: "all" | readonly ToolkitMode[];
  createToolkit: (input: ToolkitInput) => ToolkitEntries;
}[] = [
  {
    id: "core-base",
    appliesTo: "all",
    createToolkit: (input) => createCoreBaseToolkit(input),
  },
  {
    id: "core-write",
    appliesTo: ["write"],
    createToolkit: (input) => createCoreWriteToolkit(input),
  },
  {
    id: "git",
    appliesTo: "all",
    createToolkit: (input) => {
      const git = createGitOps(input.workspace);
      return createGitToolkit({
        git,
        session: input.session,
        onToolOutput: input.onToolOutput,
        emitHeadTailLines,
        stripGitShowMetadataForPreview,
      });
    },
  },
];

function collectToolkitEntries(
  workspace: string,
  session: SessionContext,
  mode: ToolkitMode,
  onToolOutput?: ToolOutputListener,
): ToolkitEntries {
  const combined: ToolkitEntries = {};
  for (const toolkit of TOOLKIT_REGISTRY) {
    if (toolkit.appliesTo !== "all" && !toolkit.appliesTo.includes(mode)) continue;
    Object.assign(combined, toolkit.createToolkit({ workspace, session, onToolOutput }));
  }
  return combined;
}

type ToolInstructionMap = Record<ToolName, { instruction: string }>;

function asToolInstructions(entries: ToolkitEntries): ToolInstructionMap {
  const meta: Record<string, { instruction: string }> = {};
  for (const tool of Object.values(entries)) {
    if (typeof tool.id !== "string") continue;
    if (typeof tool.instruction === "string") meta[tool.id] = { instruction: tool.instruction };
  }
  return meta as ToolInstructionMap;
}

export const toolMeta: ToolInstructionMap = asToolInstructions(
  collectToolkitEntries(resolve(process.cwd()), createSessionContext(), "write"),
);

export function toolsForAgent(options?: { workspace?: string; onToolOutput?: ToolOutputListener; taskId?: string }): {
  tools: Toolset;
  session: SessionContext;
} {
  const workspace = options?.workspace ?? resolve(process.cwd());
  const session = createSessionContext(options?.taskId);
  const mode = appConfig.agent.permissions.mode === "read" ? "read" : "write";
  return {
    tools: collectToolkitEntries(workspace, session, mode, options?.onToolOutput) as unknown as Toolset,
    session,
  };
}

export { withToolError, webSearchStreamRows };
