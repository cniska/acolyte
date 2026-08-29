import { resolve } from "node:path";
import { invariant } from "./assert";
import { createCodeToolkit } from "./code-toolkit";
import type { ResolvedFeatureFlags } from "./feature-flags-contract";
import { DEFAULT_FEATURE_FLAGS } from "./feature-flags-contract";
import { createFileToolkit } from "./file-toolkit";
import { createGhToolkit } from "./gh-toolkit";
import { createGitToolkit } from "./git-toolkit";
import { bindMcpTools, type McpToolListing } from "./mcp-client";
import { createMemoryToolkit } from "./memory-toolkit";
import { createSessionToolkit } from "./session-toolkit";
import { createShellToolkit } from "./shell-toolkit";
import { createSkillToolkit } from "./skill-toolkit";
import { createTasklistToolkit } from "./tasklist-toolkit";
import { createTestToolkit } from "./test-toolkit";
import type {
  SessionContext,
  SkillActivatedListener,
  SkillDeactivatedListener,
  TasklistListener,
  ToolCategory,
  ToolDefinition,
  ToolkitInput,
} from "./tool-contract";
import type { ToolOutputListener } from "./tool-output-format";
import { createSessionContext } from "./tool-session";
import { createUndoToolkit } from "./undo-toolkit";
import { createWebToolkit } from "./web-toolkit";

type ToolMap = Record<string, ToolDefinition>;

type RegisteredToolkit = ReturnType<typeof createFileToolkit> &
  ReturnType<typeof createCodeToolkit> &
  ReturnType<typeof createWebToolkit> &
  ReturnType<typeof createShellToolkit> &
  ReturnType<typeof createTestToolkit> &
  ReturnType<typeof createGhToolkit> &
  ReturnType<typeof createGitToolkit> &
  ReturnType<typeof createTasklistToolkit> &
  ReturnType<typeof createSessionToolkit> &
  ReturnType<typeof createMemoryToolkit> &
  ReturnType<typeof createSkillToolkit> &
  ReturnType<typeof createUndoToolkit>;

export type Toolset = {
  [Key in keyof RegisteredToolkit]: RegisteredToolkit[Key];
};

export const TOOLKIT_REGISTRY: {
  id: string;
  featureFlag?: keyof ResolvedFeatureFlags;
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
    featureFlag: "undoCheckpoints",
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
    id: "tasklist",
    createToolkit: (input) => createTasklistToolkit(input),
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
const noopTasklist: TasklistListener = () => {};
const noopSkillActivated: SkillActivatedListener = () => {};
const noopSkillDeactivated: SkillDeactivatedListener = () => {};

function collectTools(
  workspace: string,
  session: SessionContext,
  features: ResolvedFeatureFlags,
  onOutput: ToolOutputListener = noopOutput,
  onTasklist: TasklistListener = noopTasklist,
  onSkillActivated: SkillActivatedListener = noopSkillActivated,
  onSkillDeactivated: SkillDeactivatedListener = noopSkillDeactivated,
  sessionId?: string,
): ToolMap {
  const combined: ToolMap = {};
  for (const toolkit of TOOLKIT_REGISTRY) {
    if (toolkit.featureFlag && !features[toolkit.featureFlag]) continue;
    Object.assign(
      combined,
      toolkit.createToolkit({
        workspace,
        session,
        sessionId,
        onOutput,
        onTasklist,
        onSkillActivated,
        onSkillDeactivated,
      }),
    );
  }
  return combined;
}

function asToolDefinitionsById(entries: ToolMap): Record<string, ToolDefinition> {
  const byId: Record<string, ToolDefinition> = {};
  for (const tool of Object.values(entries)) {
    invariant(typeof tool.id === "string" && tool.id.trim().length > 0, "tool id is required");
    invariant(typeof tool.category === "string" && tool.category.trim().length > 0, `tool ${tool.id} missing category`);
    byId[tool.id] = tool;
  }
  return byId;
}

export const toolDefinitionsById = asToolDefinitionsById(
  collectTools(resolve(process.cwd()), createSessionContext(), DEFAULT_FEATURE_FLAGS),
);

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

export function toolsForAgent(options?: {
  workspace?: string;
  onOutput?: ToolOutputListener;
  onTasklist?: TasklistListener;
  onSkillActivated?: SkillActivatedListener;
  onSkillDeactivated?: SkillDeactivatedListener;
  taskId?: string;
  sessionId?: string;
  mcpListings?: McpToolListing[];
  features?: ResolvedFeatureFlags;
}): {
  tools: Toolset;
  session: SessionContext;
} {
  const workspace = options?.workspace ?? resolve(process.cwd());
  const features = options?.features ?? DEFAULT_FEATURE_FLAGS;
  const session = createSessionContext(options?.taskId);
  session.featureFlags = features;
  const base = collectTools(
    workspace,
    session,
    features,
    options?.onOutput,
    options?.onTasklist,
    options?.onSkillActivated,
    options?.onSkillDeactivated,
    options?.sessionId,
  );
  if (options?.mcpListings?.length) {
    const nativeIds = new Set(Object.keys(base));
    Object.assign(base, bindMcpTools(options.mcpListings, session, nativeIds, options.sessionId));
  }
  const idsInCategory = (category: ToolCategory): ReadonlySet<string> =>
    new Set(
      Object.values(base)
        .filter((tool) => tool.category === category)
        .map((tool) => tool.id),
    );
  session.writeTools = idsInCategory("write");
  session.readTools = idsInCategory("read");
  session.searchTools = idsInCategory("search");
  session.discoveryTools = new Set([...session.readTools, ...session.searchTools]);
  return {
    tools: base as unknown as Toolset,
    session,
  };
}
