import { resolve } from "node:path";
import { appConfig } from "./app-config";
import { createGitToolkit } from "./git-tools";
import {
  type CoreToolkitFactoryInput,
  createCoreBaseToolkit,
  createCoreWriteToolkit,
  emitHeadTailLines,
  guardedExecute,
  streamCallId,
  stripGitShowMetadataForPreview,
  webSearchStreamRows,
  withToolError,
} from "./mastra-core-tools";
import { createMastraGitTools } from "./mastra-git-tools";
import { createSessionContext, type SessionContext } from "./tool-guards";
import type { ToolMeta } from "./tool-meta-types";
import type { ToolName } from "./tool-names";
import type { ToolOutputListener } from "./tool-output-format";

type ToolkitMode = "read" | "write";

type ToolkitTool = { id?: string };
type ToolWithMeta = { tool: ToolkitTool; meta: ToolMeta };
type ToolkitEntries = Record<string, ToolWithMeta>;

type CoreBaseToolkitEntries = ReturnType<typeof createCoreBaseToolkit>;
type CoreWriteToolkitEntries = ReturnType<typeof createCoreWriteToolkit>;
type GitToolkitEntries = ReturnType<typeof createMastraGitTools>;
type RegisteredToolkitEntries = CoreBaseToolkitEntries & CoreWriteToolkitEntries & GitToolkitEntries;

export type Toolset = {
  [Key in keyof RegisteredToolkitEntries]: RegisteredToolkitEntries[Key]["tool"];
};

type ToolkitRegistration = {
  id: string;
  appliesTo: "all" | readonly ToolkitMode[];
  createToolkit: (input: CoreToolkitFactoryInput) => ToolkitEntries;
};

function createGitToolkitEntries(input: CoreToolkitFactoryInput): GitToolkitEntries {
  const { workspace, session, onToolOutput } = input;
  const git = createGitToolkit(workspace);
  const runtime = { session, guardedExecute, withToolError, streamCallId };
  return createMastraGitTools({
    git,
    runtime,
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

function asToolset(entries: ToolkitEntries): Partial<Toolset> {
  const tools: Partial<Toolset> = {};
  for (const [name, entry] of Object.entries(entries)) {
    (tools as Record<string, ToolkitTool>)[name] = entry.tool;
  }
  return tools;
}

function asToolMeta(entries: ToolkitEntries): Record<ToolName, ToolMeta> {
  const meta: Record<string, ToolMeta> = {};
  for (const entry of Object.values(entries)) {
    if (typeof entry.tool.id !== "string") continue;
    meta[entry.tool.id] = entry.meta;
  }
  return meta as Record<ToolName, ToolMeta>;
}

export const toolMeta: Record<ToolName, ToolMeta> = asToolMeta(
  collectToolkitEntries(resolve(process.cwd()), createSessionContext(), "write"),
);

function createToolset(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  return {
    tools: asToolset(collectToolkitEntries(workspace, session, "write", onToolOutput)) as Toolset,
    session,
  };
}

function readOnlyTools(
  workspace: string,
  session: SessionContext,
  onToolOutput?: ToolOutputListener,
): { tools: Partial<Toolset>; session: SessionContext } {
  return {
    tools: asToolset(collectToolkitEntries(workspace, session, "read", onToolOutput)),
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
