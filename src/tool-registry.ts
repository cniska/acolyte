import { resolve } from "node:path";
import { invariant } from "./assert";
import { createCoreToolkit, type ToolkitInput } from "./core-toolkit";
import { createGitToolkit } from "./git-toolkit";
import type { ToolDefinition, ToolPermission } from "./tool-contract";
import { createSessionContext, type SessionContext } from "./tool-guards";
import type { ToolOutputListener } from "./tool-output-format";

// biome-ignore lint/suspicious/noExplicitAny: ToolDefinition variance requires any here
type ToolMap = Record<string, ToolDefinition<any>>;

type RegisteredToolkit = ReturnType<typeof createCoreToolkit> & ReturnType<typeof createGitToolkit>;

export type Toolset = {
  [Key in keyof RegisteredToolkit]: RegisteredToolkit[Key];
};

type AnyToolDefinition = ToolDefinition<unknown>;

export const TOOLKIT_REGISTRY: {
  id: string;
  createToolkit: (input: ToolkitInput) => ToolMap;
}[] = [
  {
    id: "core",
    createToolkit: (input) => createCoreToolkit(input),
  },
  {
    id: "git",
    createToolkit: (input) => createGitToolkit(input),
  },
];

const noopOutput: ToolOutputListener = () => {};

function collectTools(workspace: string, session: SessionContext, onOutput: ToolOutputListener = noopOutput): ToolMap {
  const combined: ToolMap = {};
  for (const toolkit of TOOLKIT_REGISTRY) {
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
    invariant(Array.isArray(tool.permissions) && tool.permissions.length > 0, `tool ${tool.id} missing permissions`);
    byId[tool.id] = tool as AnyToolDefinition;
  }
  return byId;
}

export const toolDefinitionsById = asToolDefinitionsById(collectTools(resolve(process.cwd()), createSessionContext()));

export function hasPermissions(granted: readonly ToolPermission[], required: readonly ToolPermission[]): boolean {
  return required.every((p) => granted.includes(p));
}

export function toolIdsForGrants(grants: readonly ToolPermission[]): string[] {
  return Object.values(toolDefinitionsById)
    .filter((tool) => hasPermissions(grants, tool.permissions))
    .map((tool) => tool.id)
    .sort();
}

export function writeToolIds(): string[] {
  return Object.values(toolDefinitionsById)
    .filter((tool) => tool.permissions.includes("write"))
    .map((tool) => tool.id)
    .sort();
}

export function toolsForAgent(options?: { workspace?: string; onOutput?: ToolOutputListener; taskId?: string }): {
  tools: Toolset;
  session: SessionContext;
} {
  const workspace = options?.workspace ?? resolve(process.cwd());
  const session = createSessionContext(options?.taskId);
  return {
    tools: collectTools(workspace, session, options?.onOutput) as unknown as Toolset,
    session,
  };
}
