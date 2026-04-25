import { resolve } from "node:path";
import { invariant } from "./assert";
import { createChecklistToolkit } from "./checklist-toolkit";
import { createCodeToolkit } from "./code-toolkit";
import { createFileToolkit } from "./file-toolkit";
import { createGhToolkit } from "./gh-toolkit";
import { createGitToolkit } from "./git-toolkit";
import { bindMcpTools, type McpToolListing } from "./mcp-client";
import { createMemoryToolkit } from "./memory-toolkit";
import { createSessionToolkit } from "./session-toolkit";
import { createShellToolkit } from "./shell-toolkit";
import { createSkillToolkit } from "./skill-toolkit";
import { createTestToolkit } from "./test-toolkit";
import { createToolCache } from "./tool-cache";
import { getDefaultToolCacheStore } from "./tool-cache-store";
import type { ChecklistListener, ToolCategory, ToolDefinition, ToolkitInput } from "./tool-contract";
import type { ToolOutputListener } from "./tool-output-format";
import { createSessionContext, type SessionContext } from "./tool-session";
import { createUndoToolkit } from "./undo-toolkit";
import { createWebToolkit } from "./web-toolkit";

// biome-ignore lint/suspicious/noExplicitAny: ToolDefinition variance requires any here
type ToolMap = Record<string, ToolDefinition<any>>;

type RegisteredToolkit = ReturnType<typeof createFileToolkit> &
  ReturnType<typeof createCodeToolkit> &
  ReturnType<typeof createWebToolkit> &
  ReturnType<typeof createShellToolkit> &
  ReturnType<typeof createTestToolkit> &
  ReturnType<typeof createGhToolkit> &
  ReturnType<typeof createGitToolkit> &
  ReturnType<typeof createChecklistToolkit> &
  ReturnType<typeof createSessionToolkit> &
  ReturnType<typeof createMemoryToolkit> &
  ReturnType<typeof createSkillToolkit> &
  ReturnType<typeof createUndoToolkit>;

export type Toolset = {
  [Key in keyof RegisteredToolkit]: RegisteredToolkit[Key];
};

type AnyToolDefinition = ToolDefinition<unknown>;

export const TOOLKIT_REGISTRY: {
  id: string;
  createToolkit: (input: ToolkitInput) => ToolMap;
}[] = [
  {
    id: "code",
    createToolkit: (input) => createCodeToolkit(input),
  },
  {
    id: "file",
    createToolkit: (input) => createFileToolkit(input),
  },
  {
    id: "undo",
    createToolkit: (input) => createUndoToolkit(input),
  },
  {
    id: "session",
    createToolkit: (input) => createSessionToolkit(input),
  },
  {
    id: "memory",
    createToolkit: (input) => createMemoryToolkit(input),
  },
  {
    id: "skill",
    createToolkit: (input) => createSkillToolkit(input),
  },
  {
    id: "test",
    createToolkit: (input) => createTestToolkit(input),
  },
  {
    id: "checklist",
    createToolkit: (input) => createChecklistToolkit(input),
  },
  {
    id: "gh",
    createToolkit: (input) => createGhToolkit(input),
  },
  {
    id: "git",
    createToolkit: (input) => createGitToolkit(input),
  },
  {
    id: "web",
    createToolkit: (input) => createWebToolkit(input),
  },
  {
    id: "shell",
    createToolkit: (input) => createShellToolkit(input),
  },
];

const noopOutput: ToolOutputListener = () => {};
const noopChecklist: ChecklistListener = () => {};

function collectTools(
  workspace: string,
  session: SessionContext,
  onOutput: ToolOutputListener = noopOutput,
  onChecklist: ChecklistListener = noopChecklist,
  sessionId?: string,
): ToolMap {
  const combined: ToolMap = {};
  for (const toolkit of TOOLKIT_REGISTRY) {
    Object.assign(combined, toolkit.createToolkit({ workspace, session, sessionId, onOutput, onChecklist }));
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
export const RUNNER_TOOL_SET = new Set<string>(["shell-run", "test-run"]);

export function toolsForAgent(options?: {
  workspace?: string;
  onOutput?: ToolOutputListener;
  onChecklist?: ChecklistListener;
  taskId?: string;
  sessionId?: string;
  mcpListings?: McpToolListing[];
}): {
  tools: Toolset;
  session: SessionContext;
} {
  const workspace = options?.workspace ?? resolve(process.cwd());
  const session = createSessionContext(options?.taskId, WRITE_TOOL_SET);
  session.cache = createToolCache(DISCOVERY_TOOL_SET, undefined, getDefaultToolCacheStore(options?.sessionId));
  const base = collectTools(workspace, session, options?.onOutput, options?.onChecklist, options?.sessionId);
  if (options?.mcpListings?.length) {
    const nativeIds = new Set(Object.keys(base));
    Object.assign(base, bindMcpTools(options.mcpListings, session, nativeIds, options.sessionId));
  }
  return {
    tools: base as unknown as Toolset,
    session,
  };
}
