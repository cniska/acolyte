import { resolve } from "node:path";
import { appConfig } from "./app-config";
import { type ToolkitInput, createCoreReadToolkit, createCoreWriteToolkit } from "./core-toolkit";
import { createGitToolkit } from "./git-toolkit";
import type { ToolDefinition } from "./tool-contract";
import { createSessionContext, type SessionContext } from "./tool-guards";
import type { ToolName } from "./tool-names";
import type { ToolOutputListener } from "./tool-output-format";

type ToolkitMode = "read" | "write";

// biome-ignore lint/suspicious/noExplicitAny: ToolDefinition variance requires any here
type ToolMap = Record<string, ToolDefinition<any>>;

type RegisteredToolkit = ReturnType<typeof createCoreReadToolkit> &
  ReturnType<typeof createCoreWriteToolkit> &
  ReturnType<typeof createGitToolkit>;

export type Toolset = {
  [Key in keyof RegisteredToolkit]: RegisteredToolkit[Key];
};

export const TOOLKIT_REGISTRY: {
  id: string;
  appliesTo: "all" | readonly ToolkitMode[];
  createToolkit: (input: ToolkitInput) => ToolMap;
}[] = [
  {
    id: "core-read",
    appliesTo: "all",
    createToolkit: (input) => createCoreReadToolkit(input),
  },
  {
    id: "core-write",
    appliesTo: ["write"],
    createToolkit: (input) => createCoreWriteToolkit(input),
  },
  {
    id: "git",
    appliesTo: "all",
    createToolkit: (input) => createGitToolkit(input),
  },
];

function collectTools(
  workspace: string,
  session: SessionContext,
  mode: ToolkitMode,
  onToolOutput?: ToolOutputListener,
): ToolMap {
  const combined: ToolMap = {};
  for (const toolkit of TOOLKIT_REGISTRY) {
    if (toolkit.appliesTo !== "all" && !toolkit.appliesTo.includes(mode)) continue;
    Object.assign(combined, toolkit.createToolkit({ workspace, session, onToolOutput }));
  }
  return combined;
}

type ToolInstructionMap = Record<ToolName, { instruction: string }>;

function asToolInstructions(entries: ToolMap): ToolInstructionMap {
  const meta: Record<string, { instruction: string }> = {};
  for (const tool of Object.values(entries)) {
    if (typeof tool.id !== "string") continue;
    if (typeof tool.instruction === "string") meta[tool.id] = { instruction: tool.instruction };
  }
  return meta as ToolInstructionMap;
}

export const toolMeta: ToolInstructionMap = asToolInstructions(
  collectTools(resolve(process.cwd()), createSessionContext(), "write"),
);

export function toolsForAgent(options?: { workspace?: string; onToolOutput?: ToolOutputListener; taskId?: string }): {
  tools: Toolset;
  session: SessionContext;
} {
  const workspace = options?.workspace ?? resolve(process.cwd());
  const session = createSessionContext(options?.taskId);
  const mode = appConfig.agent.permissions.mode === "read" ? "read" : "write";
  return {
    tools: collectTools(workspace, session, mode, options?.onToolOutput) as unknown as Toolset,
    session,
  };
}
