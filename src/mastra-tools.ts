import { resolve } from "node:path";
import { appConfig } from "./app-config";
import { createGitToolkit } from "./git-toolkit";
import {
  type CoreToolkitFactoryInput,
  createCoreBaseToolkitTools,
  createCoreWriteToolkitTools,
  emitHeadTailLines,
  guardedExecute,
  streamCallId,
  stripGitShowMetadataForPreview,
  webSearchStreamRows,
  withToolError,
} from "./mastra-core-tools";
import { createMastraGitTools } from "./mastra-git-tools";
import { createSessionContext, type SessionContext } from "./tool-guards";
import type { ToolOutputListener } from "./tool-output-format";

type ToolkitMode = "read" | "write";

type GitTools = ReturnType<typeof createMastraGitTools>;

export type Toolset = ReturnType<typeof createCoreBaseToolkitTools> &
  ReturnType<typeof createCoreWriteToolkitTools> & {
    gitStatus: GitTools["gitStatus"];
    gitDiff: GitTools["gitDiff"];
    gitLog: GitTools["gitLog"];
    gitShow: GitTools["gitShow"];
  };

type ToolkitRegistration = {
  id: string;
  appliesTo: "all" | readonly ToolkitMode[];
  createTools: (input: CoreToolkitFactoryInput) => Partial<Toolset>;
};

function createGitToolkitTools(input: CoreToolkitFactoryInput): Partial<Toolset> {
  const { workspace, session, onToolOutput } = input;
  const git = createGitToolkit(workspace);
  const runtime = { session, guardedExecute, withToolError, streamCallId };
  return {
    ...createMastraGitTools({
      git,
      runtime,
      onToolOutput,
      emitHeadTailLines,
      stripGitShowMetadataForPreview,
    }),
  };
}

const TOOLKIT_REGISTRY: ToolkitRegistration[] = [
  {
    id: "core-base",
    appliesTo: "all",
    createTools: createCoreBaseToolkitTools,
  },
  {
    id: "core-write",
    appliesTo: ["write"],
    createTools: createCoreWriteToolkitTools,
  },
  {
    id: "git",
    appliesTo: "all",
    createTools: createGitToolkitTools,
  },
];

function toolkitTools(
  workspace: string,
  session: SessionContext,
  onToolOutput: ToolOutputListener | undefined,
  mode: ToolkitMode,
): Partial<Toolset> {
  const combined: Partial<Toolset> = {};
  for (const toolkit of TOOLKIT_REGISTRY) {
    if (toolkit.appliesTo !== "all" && !toolkit.appliesTo.includes(mode)) continue;
    const tools = toolkit.createTools({ workspace, session, onToolOutput });
    Object.assign(combined, tools);
  }
  return combined;
}

function createToolset(workspace: string, session: SessionContext, onToolOutput?: ToolOutputListener) {
  const tools = toolkitTools(workspace, session, onToolOutput, "write");
  return {
    tools: tools as Toolset,
    session,
  };
}

function readOnlyTools(
  workspace: string,
  session: SessionContext,
  onToolOutput?: ToolOutputListener,
): { tools: Partial<Toolset>; session: SessionContext } {
  return {
    tools: toolkitTools(workspace, session, onToolOutput, "read"),
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
