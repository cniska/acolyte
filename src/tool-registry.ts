import { resolve } from "node:path";
import { appConfig } from "./app-config";
import { createGitToolkit } from "./git-tools";
import {
  type CoreToolkitFactoryInput,
  createCoreBaseToolkit,
  createCoreWriteToolkit,
  emitHeadTailLines,
  streamCallId,
  stripGitShowMetadataForPreview,
  webSearchStreamRows,
  withToolError,
} from "./core-tool-defs";
import { createMastraGitTools } from "./git-tool-defs";
import type { ToolDefinition } from "./tool-contract";
import { createSessionContext, type SessionContext } from "./tool-guards";
import type { ToolName } from "./tool-names";
import type { ToolOutputListener } from "./tool-output-format";

type ToolkitMode = "read" | "write";

// biome-ignore lint/suspicious/noExplicitAny: ToolDefinition variance requires any here
type ToolkitEntries = Record<string, ToolDefinition<any>>;

type CoreBaseToolkitEntries = ReturnType<typeof createCoreBaseToolkit>;
type CoreWriteToolkitEntries = ReturnType<typeof createCoreWriteToolkit>;
type GitToolkitEntries = ReturnType<typeof createMastraGitTools>;
type RegisteredToolkitEntries = CoreBaseToolkitEntries & CoreWriteToolkitEntries & GitToolkitEntries;

export type Toolset = {
  [Key in keyof RegisteredToolkitEntries]: RegisteredToolkitEntries[Key];
};

type ToolkitRegistration = {
  id: string;
  appliesTo: "all" | readonly ToolkitMode[];
  createToolkit: (input: CoreToolkitFactoryInput) => ToolkitEntries;
};

function createGitToolkitEntries(input: CoreToolkitFactoryInput): GitToolkitEntries {
  const { workspace, session, onToolOutput } = input;
  const git = createGitToolkit(workspace);
  return createMastraGitTools({
    git,
    session,
    onToolOutput,
    emitHeadTailLines,
    stripGitShowMetadataForPreview,
  });
}

export const TOOLKIT_REGISTRY: ToolkitRegistration[] = [
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
    createToolkit: (input) => createGitToolkitEntries(input),
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

function createToolset(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return {
    tools: collectToolkitEntries(workspace, session, "write", onToolOutput) as unknown as Toolset,
    session,
  };
}

function readOnlyTools(
  workspace: string,
  session: SessionContext,
  onToolOutput?: ToolOutputListener,
): { tools: Partial<Toolset>; session: SessionContext } {
  return {
    tools: collectToolkitEntries(workspace, session, "read", onToolOutput) as unknown as Partial<Toolset>,
    session,
  };
}

export function toolsForAgent(options?: { workspace?: string; onToolOutput?: ToolOutputListener; taskId?: string }): {
  tools: Partial<Toolset>;
  session: SessionContext;
} {
  const workspace = options?.workspace ?? resolve(process.cwd());
  const session = createSessionContext(options?.taskId);
  if (appConfig.agent.permissions.mode === "read") return readOnlyTools(workspace, session, options?.onToolOutput);
  return createToolset(workspace, session, options?.onToolOutput);
}

export { withToolError, webSearchStreamRows };
