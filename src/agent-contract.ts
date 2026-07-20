import type {
  LanguageModelV4,
  LanguageModelV4FinishReason,
  LanguageModelV4Message,
  SharedV4ProviderOptions,
} from "@ai-sdk/provider";
import type { ChecklistItem } from "./checklist-contract";
import type { ReasoningLevel } from "./config-contract";
import type { ActiveSkill } from "./skill-contract";
import type { ToolDefinition } from "./tool-contract";
import type { ToolOutputPart } from "./tool-output-contract";

export type ToolCallEntry = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type GenerateResult = {
  /** The model's latest non-blank assistant text; later steps supersede earlier ones. */
  text: string;
  /** Whether `text` was emitted to the client as streamed deltas. False for host-synthesized
   *  text (e.g. a yield/stopped notice injected after the stream ended) so the client knows to
   *  render it rather than assume it is already on screen. Absent counts as false — a result
   *  built outside the streamer (a host notice) was never streamed. */
  textStreamed?: boolean;
  toolCalls: ToolCallEntry[];
  /** The unified finish reason of the terminating model step, surfaced for trace observability. */
  finishReason?: LanguageModelV4FinishReason["unified"];
};

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
  | { type: "model-usage"; payload: ModelUsagePayload }
  | SideEffectChunk;

// Effects a tool raises mid-execute (output rows, checklists, skill lifecycle). They ride the
// same ordered `fullStream` as text and tool calls so the transcript order is structurally
// faithful — a tool can only emit them from inside its `execute`, between its tool-call and
// tool-result chunks.
export type SideEffectChunk =
  | { type: "tool-output"; toolName: string; content: ToolOutputPart; toolCallId?: string }
  | { type: "checklist"; groupId: string; groupTitle: string; items: ChecklistItem[] }
  | { type: "skill-activated"; skill: ActiveSkill }
  | { type: "skill-deactivated"; name: string };

export type SideEffectSink = (chunk: SideEffectChunk) => void;

export type Agent = {
  readonly id: string;
  readonly name: string;
  readonly instructions: string | (() => string | Promise<string>);
  readonly model: LanguageModelV4;
  readonly tools: Record<string, ToolDefinition>;
  stream(prompt: string, options: StreamOptions): Promise<StreamOutput>;
};

export type OnBeforeFinishResult = LanguageModelV4Message[];

export type StreamOptions = {
  temperature?: number;
  reasoning?: ReasoningLevel;
  providerOptions?: SharedV4ProviderOptions;
  preCallInputTokenLimit?: number;
  // Installed for the lifetime of one stream so tool-raised effects enqueue onto `fullStream`;
  // the streamer calls it with `null` once the stream closes.
  installSideEffectSink?: (sink: SideEffectSink | null) => void;
  onBeforeNextCall?: (messages: readonly LanguageModelV4Message[]) => LanguageModelV4Message[];
  onBeforeFinish?: (attempt: {
    messages: readonly LanguageModelV4Message[];
    text: string;
    answerText: string;
    finishReason?: LanguageModelV4FinishReason["unified"];
  }) => OnBeforeFinishResult;
};

export type StreamOutput = {
  fullStream: ReadableStream<StreamChunk>;
  getFullOutput(): Promise<GenerateResult>;
};
