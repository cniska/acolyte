import { resolve } from "node:path";
import type { AgentMode } from "./agent-modes";
import { appConfig } from "./app-config";
import { invariant } from "./assert";
import type { PermissionMode } from "./config-contract";
import { createCoreReadToolkit, createCoreWriteToolkit, type ToolkitInput } from "./core-toolkit";
import { createGitReadToolkit, createGitWriteToolkit } from "./git-toolkit";
import type { ToolDefinition } from "./tool-contract";
import { createSessionContext, type SessionContext } from "./tool-guards";
import type { ToolOutputListener } from "./tool-output-format";

// biome-ignore lint/suspicious/noExplicitAny: ToolDefinition variance requires any here
type ToolMap = Record<string, ToolDefinition<any>>;

type RegisteredToolkit = ReturnType<typeof createCoreReadToolkit> &
  ReturnType<typeof createCoreWriteToolkit> &
  ReturnType<typeof createGitReadToolkit> &
  ReturnType<typeof createGitWriteToolkit>;

export type Toolset = {
  [Key in keyof RegisteredToolkit]: RegisteredToolkit[Key];
};

type AnyToolDefinition = ToolDefinition<unknown>;

export const TOOLKIT_REGISTRY: {
  id: string;
  permissions: readonly PermissionMode[];
  createToolkit: (input: ToolkitInput) => ToolMap;
}[] = [
  {
    id: "core-read",
    permissions: ["read", "write"],
    createToolkit: (input) => createCoreReadToolkit(input),
  },
  {
    id: "core-write",
    permissions: ["write"],
    createToolkit: (input) => createCoreWriteToolkit(input),
  },
  {
    id: "git-read",
    permissions: ["read", "write"],
    createToolkit: (input) => createGitReadToolkit(input),
  },
  {
    id: "git-write",
    permissions: ["write"],
    createToolkit: (input) => createGitWriteToolkit(input),
  },
];

const noopOutput: ToolOutputListener = () => {};

function collectTools(
  workspace: string,
  session: SessionContext,
  mode: PermissionMode,
  onOutput: ToolOutputListener = noopOutput,
): ToolMap {
  const combined: ToolMap = {};
  for (const toolkit of TOOLKIT_REGISTRY) {
    if (!toolkit.permissions.includes(mode)) continue;
    Object.assign(combined, toolkit.createToolkit({ workspace, session, onOutput }));
  }
  return combined;
}

function asToolDefinitionsById(entries: ToolMap): Record<string, AnyToolDefinition> {
  const byId: Record<string, AnyToolDefinition> = {};
  for (const tool of Object.values(entries)) {
    invariant(typeof tool.id === "string" && tool.id.trim().length > 0, "tool id is required");
    invariant(typeof tool.label === "string" && tool.label.trim().length > 0, `tool ${tool.id} missing label`);
    invariant(
      typeof tool.instruction === "string" && tool.instruction.trim().length > 0,
      `tool ${tool.id} missing instruction`,
    );
    invariant(Array.isArray(tool.modes) && tool.modes.length > 0, `tool ${tool.id} missing modes`);
    byId[tool.id] = tool as AnyToolDefinition;
  }
  return byId;
}

export const toolDefinitionsById = asToolDefinitionsById(
  collectTools(resolve(process.cwd()), createSessionContext(), "write"),
);

export function toolIdsForMode(mode: AgentMode): string[] {
  return Object.values(toolDefinitionsById)
    .filter((tool) => tool.modes.includes(mode))
    .map((tool) => tool.id)
    .sort();
}

export function toolsForAgent(options?: { workspace?: string; onOutput?: ToolOutputListener; taskId?: string }): {
  tools: Toolset;
  session: SessionContext;
} {
  const workspace = options?.workspace ?? resolve(process.cwd());
  const session = createSessionContext(options?.taskId);
  const mode: PermissionMode = appConfig.agent.permissions.mode === "read" ? "read" : "write";
  return {
    tools: collectTools(workspace, session, mode, options?.onOutput) as unknown as Toolset,
    session,
  };
}
