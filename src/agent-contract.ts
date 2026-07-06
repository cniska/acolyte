import type { LanguageModelV4, LanguageModelV4Message, SharedV4ProviderOptions } from "@ai-sdk/provider";
import { z } from "zod";
import type { ReasoningLevel } from "./config-contract";
import type { ToolDefinition } from "./tool-contract";

export type ToolCallEntry = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type GenerateResult = {
  /** The model's latest non-blank assistant text; later steps supersede earlier ones. */
  text: string;
  toolCalls: ToolCallEntry[];
  signal?: LifecycleSignal;
  signalReason?: string;
};

const lifecycleSignalSchema = z.enum(["done", "noop", "blocked"]);
export type LifecycleSignal = z.infer<typeof lifecycleSignalSchema>;

export const lifecycleSignalToolNameSchema = z.enum(["signal_done", "signal_noop", "signal_blocked"]);
export type LifecycleSignalToolName = z.infer<typeof lifecycleSignalToolNameSchema>;

const signalToolToSignal: Record<LifecycleSignalToolName, LifecycleSignal> = {
  signal_done: "done",
  signal_noop: "noop",
  signal_blocked: "blocked",
};

export function signalForToolName(toolName: string): LifecycleSignal | undefined {
  const parsed = lifecycleSignalToolNameSchema.safeParse(toolName);
  if (!parsed.success) return undefined;
  return signalToolToSignal[parsed.data];
}

export type TextDeltaPayload = { text?: string };
export type ToolCallPayload = { toolCallId?: string; toolName?: string; args?: Record<string, unknown> };
export type ToolResultPayload = { toolCallId?: string; toolName?: string; result?: unknown };
export type ToolErrorPayload = {
  error?: unknown;
  message?: string;
  code?: unknown;
  kind?: unknown;
  toolName?: string;
  toolCallId?: string;
};
export type ModelUsagePayload = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
};
export type StreamChunk =
  | { type: "step-start" }
  | { type: "text-delta"; payload: TextDeltaPayload }
  | { type: "reasoning-delta"; payload: TextDeltaPayload }
  | { type: "tool-call"; payload: ToolCallPayload }
  | { type: "tool-result"; payload: ToolResultPayload }
  | { type: "tool-error"; payload: ToolErrorPayload }
  | { type: "model-usage"; payload: ModelUsagePayload };

export type Agent = {
  readonly id: string;
  readonly name: string;
  readonly instructions: string | (() => string | Promise<string>);
  readonly model: LanguageModelV4;
  readonly tools: Record<string, ToolDefinition>;
  stream(prompt: string, options: StreamOptions): Promise<StreamOutput>;
};

export type StreamOptions = {
  toolChoice?: "auto" | "none" | "required";
  temperature?: number;
  reasoning?: ReasoningLevel;
  providerOptions?: SharedV4ProviderOptions;
  preCallInputTokenLimit?: number;
  onBeforeNextCall?: (messages: readonly LanguageModelV4Message[]) => LanguageModelV4Message[];
  onBeforeFinish?: (attempt: {
    messages: readonly LanguageModelV4Message[];
    text: string;
    signal?: LifecycleSignal;
  }) => LanguageModelV4Message[];
};

export type StreamOutput = {
  fullStream: ReadableStream<StreamChunk>;
  getFullOutput(): Promise<GenerateResult>;
};
