import { resolve } from "node:path";
import { appConfig } from "./app-config";
import { invariant } from "./assert";
import { createChecklistToolkit } from "./checklist-toolkit";
import { createCodeToolkit } from "./code-toolkit";
import { createFileToolkit } from "./file-toolkit";
import { createGitToolkit } from "./git-toolkit";
import { createMemoryToolkit } from "./memory-toolkit";
import { createShellToolkit } from "./shell-toolkit";
import { createTestToolkit } from "./test-toolkit";
import { createToolCache } from "./tool-cache";
import { getDefaultToolCacheStore } from "./tool-cache-store";
import type { ChecklistListener, ToolCategory, ToolDefinition, ToolkitDeps, ToolkitInput } from "./tool-contract";
import type { ToolOutputListener } from "./tool-output-format";
import { createSessionContext, type SessionContext } from "./tool-session";
import { createWebToolkit } from "./web-toolkit";

// biome-ignore lint/suspicious/noExplicitAny: ToolDefinition variance requires any here
type ToolMap = Record<string, ToolDefinition<any>>;

type RegisteredToolkit = ReturnType<typeof createFileToolkit> &
  ReturnType<typeof createCodeToolkit> &
  ReturnType<typeof createWebToolkit> &
  ReturnType<typeof createShellToolkit> &
  ReturnType<typeof createTestToolkit> &
  ReturnType<typeof createGitToolkit> &
  ReturnType<typeof createChecklistToolkit> &
  ReturnType<typeof createMemoryToolkit>;

export type Toolset = {
  [Key in keyof RegisteredToolkit]: RegisteredToolkit[Key];
};

type AnyToolDefinition = ToolDefinition<unknown>;

export const TOOLKIT_REGISTRY: {
  id: string;
  createToolkit: (deps: ToolkitDeps, input: ToolkitInput) => ToolMap;
}[] = [
  {
    id: "file",
    createToolkit: (deps, input) => createFileToolkit(deps, input),
  },
  {
    id: "code",
    createToolkit: (deps, input) => createCodeToolkit(deps, input),
  },
  {
    id: "web",
    createToolkit: (deps, input) => createWebToolkit(deps, input),
  },
  {
    id: "shell",
    createToolkit: (deps, input) => createShellToolkit(deps, input),
  },
  {
    id: "test",
    createToolkit: (deps, input) => createTestToolkit(deps, input),
  },
  {
    id: "git",
    createToolkit: (deps, input) => createGitToolkit(deps, input),
  },
  {
    id: "checklist",
    createToolkit: (deps, input) => createChecklistToolkit(deps, input),
  },
  {
    id: "memory",
    createToolkit: (deps, input) => createMemoryToolkit(deps, input),
  },
];

const noopOutput: ToolOutputListener = () => {};
const noopChecklist: ChecklistListener = () => {};

const defaultToolkitDeps = (): ToolkitDeps => ({
  outputBudget: appConfig.agent.toolOutputBudget,
});

function collectTools(
  workspace: string,
  session: SessionContext,
  onOutput: ToolOutputListener = noopOutput,
  onChecklist: ChecklistListener = noopChecklist,
  deps: ToolkitDeps = defaultToolkitDeps(),
): ToolMap {
  const combined: ToolMap = {};
  for (const toolkit of TOOLKIT_REGISTRY) {
    Object.assign(combined, toolkit.createToolkit(deps, { workspace, session, onOutput, onChecklist }));
  }
  return combined;
}

function asToolDefinitionsById(entries: ToolMap): Record<string, AnyToolDefinition> {
  const byId: Record<string, AnyToolDefinition> = {};
  for (const tool of Object.values(entries)) {
    invariant(typeof tool.id === "string" && tool.id.trim().length > 0, "tool id is required");
    invariant(typeof tool.category === "string" && tool.category.trim().length > 0, `tool ${tool.id} missing category`);
    invariant(
      typeof tool.instruction === "string" && tool.instruction.trim().length > 0,
      `tool ${tool.id} missing instruction`,
    );
    byId[tool.id] = tool as AnyToolDefinition;
  }
  return byId;
}

export const toolDefinitionsById = asToolDefinitionsById(collectTools(resolve(process.cwd()), createSessionContext()));

export function toolIds(): string[] {
  return Object.values(toolDefinitionsById)
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

export function toolsForAgent(options?: {
  workspace?: string;
  onOutput?: ToolOutputListener;
  onChecklist?: ChecklistListener;
  taskId?: string;
  sessionId?: string;
}): {
  tools: Toolset;
  session: SessionContext;
} {
  const workspace = options?.workspace ?? resolve(process.cwd());
  const session = createSessionContext(options?.taskId, WRITE_TOOL_SET);
  session.cache = createToolCache(DISCOVERY_TOOL_SET, undefined, getDefaultToolCacheStore(options?.sessionId));
  return {
    tools: collectTools(workspace, session, options?.onOutput, options?.onChecklist) as unknown as Toolset,
    session,
  };
}
