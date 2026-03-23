import { z } from "zod";
import { agentModeSchema } from "./agent-contract";
import { type ChatRequest, type ChatResponse, chatResponseStateSchema } from "./api";
import { invariant } from "./assert";
import { rpcServerMessageSchema } from "./rpc-protocol";
import type { StatusFields } from "./status-contract";
import { streamErrorSchema } from "./stream-error";
import type { TaskId, TaskRecord } from "./task-contract";
import type { ToolOutputPart } from "./tool-output-content";
import { toolOutputPartSchema } from "./tool-output-content";

export const pendingStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("queued"), position: z.number().int().nonnegative().optional() }),
  z.object({ kind: z.literal("accepted") }),
  z.object({
    kind: z.literal("running"),
    mode: agentModeSchema,
    model: z.string().optional(),
  }),
]);
export type PendingState = z.infer<typeof pendingStateSchema>;

type UsageLikePayload = {
  inputTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
  promptTokens?: unknown;
  completionTokens?: unknown;
  inputBudgetTokens?: unknown;
  inputTruncated?: unknown;
  promptBudgetTokens?: unknown;
  promptTruncated?: unknown;
};

type ParsedUsagePayload = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputBudgetTokens?: number;
  inputTruncated?: boolean;
};

export interface ClientOptions {
  apiUrl: string;
  apiKey?: string;
  replyTimeoutMs?: number;
}

const streamUsageEventSchema = z
  .object({
    type: z.literal("usage"),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    promptTokens: z.number().optional(),
    completionTokens: z.number().optional(),
  })
  .refine(
    (value) =>
      (typeof value.inputTokens === "number" && typeof value.outputTokens === "number") ||
      (typeof value.promptTokens === "number" && typeof value.completionTokens === "number"),
    {
      message: "usage event missing token counters",
    },
  );

export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text-delta"), text: z.string() }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    type: z.literal("tool-output"),
    toolCallId: z.string(),
    toolName: z.string(),
    content: toolOutputPartSchema,
  }),
  z.object({
    type: z.literal("tool-result"),
    toolCallId: z.string(),
    toolName: z.string(),
    isError: z.boolean().optional(),
    errorCode: z.string().optional(),
    error: streamErrorSchema.optional(),
  }),
  streamUsageEventSchema,
  z.object({ type: z.literal("status"), state: pendingStateSchema }),
  z.object({
    type: z.literal("error"),
    errorMessage: z.string(),
    errorId: z.string().optional(),
    errorCode: z.string().optional(),
    error: streamErrorSchema.optional(),
  }),
]);

type TextDeltaEvent = { type: "text-delta"; text: string };
type ReasoningEvent = { type: "reasoning"; text: string };
type ToolCallEvent = { type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, unknown> };
type ToolOutputEvent = {
  type: "tool-output";
  toolCallId: string;
  toolName: string;
  content: ToolOutputPart;
};
type ToolResultEvent = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  isError?: boolean;
  errorCode?: string;
  error?: z.infer<typeof streamErrorSchema>;
};
type UsageEvent = { type: "usage"; inputTokens: number; outputTokens: number };
type StatusEvent = { type: "status"; state: PendingState };
type ErrorEvent = {
  type: "error";
  errorMessage: string;
  errorId?: string;
  errorCode?: string;
  error?: z.infer<typeof streamErrorSchema>;
};

export type StreamEvent =
  | TextDeltaEvent
  | ReasoningEvent
  | ToolCallEvent
  | ToolOutputEvent
  | ToolResultEvent
  | UsageEvent
  | StatusEvent
  | ErrorEvent;

export interface Client {
  replyStream(
    input: ChatRequest,
    options: {
      onEvent: (event: StreamEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<ChatResponse>;
  status(): Promise<StatusFields>;
  taskStatus(taskId: TaskId): Promise<TaskRecord | null>;
}

export type RemoteErrorMetadata = {
  status?: number;
  errorId?: string;
  errorCode?: string;
  error?: z.infer<typeof streamErrorSchema>;
  taskId?: TaskId;
};

export function createRemoteError(message: string, metadata: RemoteErrorMetadata = {}): Error {
  return Object.assign(new Error(message), metadata);
}

export function parseRpcServerMessage(raw: unknown): z.infer<typeof rpcServerMessageSchema> | null {
  const parsed = rpcServerMessageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseStreamEvent(raw: unknown): StreamEvent | null {
  const result = streamEventSchema.safeParse(raw);
  if (!result.success) return null;
  const event = result.data;
  if (event.type === "usage") {
    const parsed = parseUsagePayload(event);
    return parsed ? { type: "usage", inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens } : null;
  }
  return event;
}

function parseUsagePayload(raw: unknown): ParsedUsagePayload | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as UsageLikePayload;
  const inputTokens = parseUsageNumber(usage.inputTokens) ?? parseUsageNumber(usage.promptTokens);
  const outputTokens = parseUsageNumber(usage.outputTokens) ?? parseUsageNumber(usage.completionTokens);
  const inputBudgetTokens = parseUsageOptionalNumber(usage, "inputBudgetTokens", "promptBudgetTokens");
  const inputTruncated = parseUsageOptionalBoolean(usage, "inputTruncated", "promptTruncated");
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens: parseUsageNumber(usage.totalTokens) ?? inputTokens + outputTokens,
    ...(typeof inputBudgetTokens === "number" ? { inputBudgetTokens } : {}),
    ...(typeof inputTruncated === "boolean" ? { inputTruncated } : {}),
  };
}

function parseUsageNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseUsageOptionalNumber(
  usage: UsageLikePayload,
  primary: keyof UsageLikePayload,
  fallback: keyof UsageLikePayload,
): number | undefined {
  return parseUsageNumber(usage[primary]) ?? parseUsageNumber(usage[fallback]);
}

function parseUsageOptionalBoolean(
  usage: UsageLikePayload,
  primary: keyof UsageLikePayload,
  fallback: keyof UsageLikePayload,
): boolean | undefined {
  const value = usage[primary];
  return typeof value === "boolean" ? value : typeof usage[fallback] === "boolean" ? usage[fallback] : undefined;
}

export function parseChatResponse(payload: unknown): ChatResponse | null {
  if (!payload || typeof payload !== "object") return null;
  const json = payload as Partial<ChatResponse>;
  if (typeof json.output !== "string") return null;
  if (typeof json.model !== "string" || json.model.trim().length === 0) return null;
  const parsedUsage = json.usage ? parseUsagePayload(json.usage) : undefined;
  // TODO(cniska): Drop legacy prompt/completion parsing at v1.0.0.
  return {
    output: json.output,
    model: json.model,
    modelCalls: typeof json.modelCalls === "number" ? json.modelCalls : undefined,
    toolCalls: Array.isArray((json as { toolCalls?: unknown }).toolCalls)
      ? ((json as { toolCalls?: unknown[] }).toolCalls ?? []).filter((item): item is string => typeof item === "string")
      : undefined,
    usage: parsedUsage,
    promptBreakdown:
      json.promptBreakdown &&
      typeof json.promptBreakdown === "object" &&
      typeof (json.promptBreakdown as { budgetTokens?: unknown }).budgetTokens === "number" &&
      typeof (json.promptBreakdown as { usedTokens?: unknown }).usedTokens === "number" &&
      typeof (json.promptBreakdown as { systemTokens?: unknown }).systemTokens === "number" &&
      typeof (json.promptBreakdown as { toolTokens?: unknown }).toolTokens === "number" &&
      typeof (json.promptBreakdown as { memoryTokens?: unknown }).memoryTokens === "number" &&
      typeof (json.promptBreakdown as { messageTokens?: unknown }).messageTokens === "number"
        ? {
            budgetTokens: (json.promptBreakdown as { budgetTokens: number }).budgetTokens,
            usedTokens: (json.promptBreakdown as { usedTokens: number }).usedTokens,
            systemTokens: (json.promptBreakdown as { systemTokens: number }).systemTokens,
            toolTokens: (json.promptBreakdown as { toolTokens: number }).toolTokens,
            memoryTokens: (json.promptBreakdown as { memoryTokens: number }).memoryTokens,
            messageTokens: (json.promptBreakdown as { messageTokens: number }).messageTokens,
          }
        : undefined,
    state: chatResponseStateSchema.catch("done").parse(json.state),
    error: typeof json.error === "string" ? json.error : undefined,
  };
}

export function validateFinalChatResponse(payload: unknown, message: string): ChatResponse {
  const parsed = parseChatResponse(payload);
  invariant(parsed, message);
  return parsed;
}

export function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("unable to connect") ||
    message.includes("typo in the url or port") ||
    message.includes("connection refused") ||
    message.includes("econnrefused") ||
    message.includes("socket connection was closed unexpectedly") ||
    message.includes("socket closed")
  );
}

export function rpcUrlFromApiUrl(apiUrl: string): string {
  const source = new URL(apiUrl);
  const protocol = source.protocol === "https:" ? "wss:" : source.protocol === "http:" ? "ws:" : source.protocol;
  const basePath = source.pathname.replace(/\/$/, "");
  const path = basePath.endsWith("/v1/rpc") ? basePath : `${basePath}/v1/rpc`;
  source.protocol = protocol;
  source.pathname = path;
  source.search = "";
  source.hash = "";
  return source.toString();
}
