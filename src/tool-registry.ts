import { resolve } from "node:path";
import { invariant } from "./assert";
import { createFileToolkit } from "./file-toolkit";
import { createGitToolkit } from "./git-toolkit";
import { createShellToolkit } from "./shell-toolkit";
import type { ToolCategory, ToolDefinition, ToolkitInput, ToolPermission } from "./tool-contract";
import { createSessionContext, type SessionContext } from "./tool-guards";
import type { ToolOutputListener } from "./tool-output-format";
import { createWebToolkit } from "./web-toolkit";

// biome-ignore lint/suspicious/noExplicitAny: ToolDefinition variance requires any here
type ToolMap = Record<string, ToolDefinition<any>>;

type RegisteredToolkit = ReturnType<typeof createFileToolkit> &
  ReturnType<typeof createWebToolkit> &
  ReturnType<typeof createShellToolkit> &
  ReturnType<typeof createGitToolkit>;

export type Toolset = {
  [Key in keyof RegisteredToolkit]: RegisteredToolkit[Key];
};

type AnyToolDefinition = ToolDefinition<unknown>;

export const TOOLKIT_REGISTRY: {
  id: string;
  createToolkit: (input: ToolkitInput) => ToolMap;
}[] = [
  {
    id: "file",
    createToolkit: (input) => createFileToolkit(input),
  },
  {
    id: "web",
    createToolkit: (input) => createWebToolkit(input),
  },
  {
    id: "shell",
    createToolkit: (input) => createShellToolkit(input),
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
    invariant(typeof tool.category === "string" && tool.category.trim().length > 0, `tool ${tool.id} missing category`);
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

export function toolIdsByCategory(category: ToolCategory): string[] {
  return Object.values(toolDefinitionsById)
    .filter((tool) => tool.category === category)
    .map((tool) => tool.id)
    .sort();
}

export const WRITE_TOOLS: readonly string[] = toolIdsByCategory("write");
export const READ_TOOLS: readonly string[] = toolIdsByCategory("read");
export const SEARCH_TOOLS: readonly string[] = toolIdsByCategory("search");
export const DISCOVERY_TOOLS: readonly string[] = [...READ_TOOLS, ...SEARCH_TOOLS].sort();

export const WRITE_TOOL_SET = new Set<string>(WRITE_TOOLS);
export const READ_TOOL_SET = new Set<string>(READ_TOOLS);
export const SEARCH_TOOL_SET = new Set<string>(SEARCH_TOOLS);
export const DISCOVERY_TOOL_SET = new Set<string>(DISCOVERY_TOOLS);

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
