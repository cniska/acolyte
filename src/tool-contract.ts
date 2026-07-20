import type { LanguageModelV4FunctionTool } from "@ai-sdk/provider";
import { z } from "zod";
import type { ChecklistItem } from "./checklist-contract";
import type { ResolvedFeatureFlags } from "./feature-flags-contract";
import { log } from "./log";
import type { ActiveSkill } from "./skill-contract";
import type { ToolOutputListener } from "./tool-output-format";
import type { WorkspaceProfile } from "./workspace-contract";

export type ToolCategory = "read" | "search" | "write" | "execute" | "network" | "meta";

const OUTPUT_SAFETY_CAP = 500_000;

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  readonly id: string;
  readonly toolkit: string;
  readonly category: ToolCategory;
  readonly description: string;
  readonly instruction: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly execute: (input: TInput, toolCallId: string) => Promise<RunToolResult<TOutput>>;
};

export type ChecklistListener = (event: { groupId: string; groupTitle: string; items: ChecklistItem[] }) => void;

export type SkillActivatedListener = (skill: ActiveSkill) => void;

export type SkillDeactivatedListener = (name: string) => void;

export type ToolkitInput = {
  workspace: string;
  session: SessionContext;
  sessionId?: string;
  onOutput: ToolOutputListener;
  onChecklist: ChecklistListener;
  onSkillActivated: SkillActivatedListener;
  onSkillDeactivated: SkillDeactivatedListener;
};

export type RunToolResult<T = unknown> = { result: T; effectOutput?: string };

export type ToolCacheEntry = {
  result: unknown;
};

export type ToolCache = {
  isCacheable(toolName: string): boolean;
  get(toolName: string, args: Record<string, unknown>): ToolCacheEntry | undefined;
  set(toolName: string, args: Record<string, unknown>, entry: ToolCacheEntry): void;
  invalidateForWrite(toolName: string, args: Record<string, unknown>): void;
  clear(): void;
  stats(): { hits: number; misses: number; invalidations: number; evictions: number; size: number };
};

export type ToolCallStatus = "succeeded" | "failed";

export type ToolCallRecord = {
  toolName: string;
  args: Record<string, unknown>;
  taskId?: string;
  resultHash?: string;
  exitCode?: number;
  status: ToolCallStatus;
};

export type ToolErrorSummary = { message: string; code?: string; kind?: string };

export type PreToolContext = { toolId: string; toolCallId: string; args: Record<string, unknown> };
export type PostToolContext =
  | {
      toolId: string;
      toolCallId: string;
      args: Record<string, unknown>;
      status: "succeeded";
      result: unknown;
    }
  | {
      toolId: string;
      toolCallId: string;
      args: Record<string, unknown>;
      status: "failed";
      error: ToolErrorSummary;
    };
export type EffectOutput = { append?: string };

export type SessionContext = {
  callLog: ToolCallRecord[];
  taskId?: string;
  maxToolCallsPerRequest?: number;
  budgetNoticeAnnounced?: boolean;
  writeTools: ReadonlySet<string>;
  toolTimeoutMs?: number;
  cache?: ToolCache;
  featureFlags?: ResolvedFeatureFlags;
  onDebug?: (event: `lifecycle.${string}`, data: Record<string, unknown>) => void;
  onBeforeTool?: (ctx: PreToolContext) => EffectOutput | undefined;
  onAfterTool?: (ctx: PostToolContext) => EffectOutput | undefined;
  onBeforeToolAsync?: (ctx: PreToolContext) => Promise<void>;
  onAfterToolAsync?: (ctx: PostToolContext) => Promise<void>;
  workspaceProfile?: WorkspaceProfile;
  activeSkills?: ActiveSkill[];
};

type CreateToolConfig<TInput, TOutput> = Omit<ToolDefinition<TInput, TOutput>, "inputSchema"> & {
  inputSchema: z.ZodType<TInput> | Record<string, unknown>;
};

function isZodSchema(s: unknown): s is z.ZodType {
  return typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).safeParse === "function";
}

function toJsonSchema(schema: z.ZodType | Record<string, unknown>): Record<string, unknown> {
  if (!isZodSchema(schema)) return schema;
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
}

type AnyToolDefinition = Pick<ToolDefinition, "id" | "description" | "inputSchema">;

export function toFunctionTool(tool: AnyToolDefinition): LanguageModelV4FunctionTool {
  return {
    type: "function",
    name: tool.id,
    description: tool.description,
    inputSchema: tool.inputSchema as LanguageModelV4FunctionTool["inputSchema"],
  };
}

export function toFunctionTools(tools: Record<string, AnyToolDefinition>): LanguageModelV4FunctionTool[] {
  return Object.values(tools).map(toFunctionTool);
}

export function createTool<TInput, TOutput>(
  config: CreateToolConfig<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> {
  const inputParser = isZodSchema(config.inputSchema) ? config.inputSchema : undefined;
  return {
    ...config,
    inputSchema: toJsonSchema(config.inputSchema),
    execute: async (input, toolCallId) => {
      const parsedInput = inputParser ? (inputParser.parse(input) as TInput) : input;
      const runResult = await config.execute(parsedInput, toolCallId);
      let parsed = config.outputSchema.parse(runResult.result);
      if (parsed && typeof parsed === "object" && "output" in parsed) {
        const output = (parsed as Record<string, unknown>).output;
        if (typeof output === "string" && output.length > OUTPUT_SAFETY_CAP) {
          log.warn("tool output truncated", { chars: output.length, cap: OUTPUT_SAFETY_CAP });
          parsed = { ...parsed, output: output.slice(0, OUTPUT_SAFETY_CAP) };
        }
      }
      return { ...runResult, result: parsed };
    },
  };
}
