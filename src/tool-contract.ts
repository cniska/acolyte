import type { LanguageModelV4FunctionTool } from "@ai-sdk/provider";
import { z } from "zod";
import type { ResolvedFeatureFlags } from "./feature-flags-contract";
import { log } from "./log";
import type { ActiveSkill } from "./skill-contract";
import type { TasklistItem } from "./tasklist-contract";
import type { ToolOutputListener } from "./tool-output-format";
import type { WorkspaceProfile } from "./workspace-contract";

export type ToolCategory = "read" | "search" | "write" | "execute" | "network" | "meta";

const OUTPUT_SAFETY_CAP = 500_000;

export type ToolDefinition<TOutput = unknown> = {
  readonly id: string;
  readonly toolkit: string;
  readonly category: ToolCategory;
  readonly description: string;
  // Optional: a tool whose description already carries its contract hoists nothing into
  // the system prompt.
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly execute: (input: unknown, toolCallId: string) => Promise<RunToolResult<TOutput>>;
};

export type TasklistListener = (event: { groupId: string; groupTitle: string; items: TasklistItem[] }) => void;

export type SkillActivatedListener = (skill: ActiveSkill) => void;

export type SkillDeactivatedListener = (name: string) => void;

export type ToolkitInput = {
  workspace: string;
  session: SessionContext;
  sessionId?: string;
  onOutput: ToolOutputListener;
  onTasklist: TasklistListener;
  onSkillActivated: SkillActivatedListener;
  onSkillDeactivated: SkillDeactivatedListener;
};

export type RunToolResult<T = unknown> = { result: T; effectOutput?: string };

export type ToolCallStatus = "succeeded" | "failed";

export type ToolCallRecord = {
  toolName: string;
  args: Record<string, unknown>;
  taskId?: string;
  resultHash?: string;
  exitCode?: number;
  command?: string;
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
  featureFlags?: ResolvedFeatureFlags;
  onDebug?: (event: `lifecycle.${string}`, data: Record<string, unknown>) => void;
  onBeforeTool?: (ctx: PreToolContext) => EffectOutput | undefined;
  onAfterTool?: (ctx: PostToolContext) => EffectOutput | undefined;
  onBeforeToolAsync?: (ctx: PreToolContext) => Promise<void>;
  onAfterToolAsync?: (ctx: PostToolContext) => Promise<void>;
  workspaceProfile?: WorkspaceProfile;
  activeSkills?: ActiveSkill[];
};

type ToolConfigBase<TOutput> = Omit<ToolDefinition<TOutput>, "inputSchema" | "execute">;

type ZodInputToolConfig<TInput, TOutput> = ToolConfigBase<TOutput> & {
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput, toolCallId: string) => Promise<RunToolResult<TOutput>>;
};

type RawInputToolConfig<TOutput> = ToolConfigBase<TOutput> & {
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, toolCallId: string) => Promise<RunToolResult<TOutput>>;
};

function isZodSchema(s: unknown): s is z.ZodType {
  return typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).safeParse === "function";
}

function toJsonSchema(schema: z.ZodType | Record<string, unknown>): Record<string, unknown> {
  if (!isZodSchema(schema)) return schema;
  const { $schema: _, ...rest } = z.toJSONSchema(schema);
  return rest;
}

type FunctionToolSource = Pick<ToolDefinition, "id" | "description" | "inputSchema">;

export function toFunctionTool(tool: FunctionToolSource): LanguageModelV4FunctionTool {
  return {
    type: "function",
    name: tool.id,
    description: tool.description,
    inputSchema: tool.inputSchema as LanguageModelV4FunctionTool["inputSchema"],
  };
}

export function toFunctionTools(tools: Record<string, FunctionToolSource>): LanguageModelV4FunctionTool[] {
  return Object.values(tools).map(toFunctionTool);
}

export function createTool<TInput, TOutput>(config: ZodInputToolConfig<TInput, TOutput>): ToolDefinition<TOutput>;
export function createTool<TOutput>(config: RawInputToolConfig<TOutput>): ToolDefinition<TOutput>;
export function createTool<TInput, TOutput>(
  config: ZodInputToolConfig<TInput, TOutput> | RawInputToolConfig<TOutput>,
): ToolDefinition<TOutput> {
  const inputParser = isZodSchema(config.inputSchema) ? config.inputSchema : undefined;
  // Sound at exactly this seam: the Zod arm receives only parser output, the raw arm declares `unknown`.
  const configExecute = config.execute as (input: unknown, toolCallId: string) => Promise<RunToolResult<TOutput>>;
  return {
    ...config,
    inputSchema: toJsonSchema(config.inputSchema),
    execute: async (input, toolCallId) => {
      const validatedInput = inputParser ? inputParser.parse(input) : input;
      const runResult = await configExecute(validatedInput, toolCallId);
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
