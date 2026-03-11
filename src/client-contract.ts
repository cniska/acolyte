import { z } from "zod";
import type { ChatRequest, ChatResponse } from "./api";
import { invariant } from "./assert";
import { rpcServerMessageSchema } from "./rpc-protocol";
import type { StatusFields } from "./status-contract";
import { streamErrorSchema } from "./stream-error";
import type { TaskId, TaskRecord } from "./task-contract";
import { toolOutputSchema } from "./tool-output-content";

export interface ClientOptions {
  apiUrl: string;
  apiKey?: string;
  replyTimeoutMs?: number;
}

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
    content: toolOutputSchema,
  }),
  z.object({
    type: z.literal("tool-result"),
    toolCallId: z.string(),
    toolName: z.string(),
    isError: z.boolean().optional(),
    errorCode: z.string().optional(),
    error: streamErrorSchema.optional(),
  }),
  z.object({ type: z.literal("usage"), promptTokens: z.number(), completionTokens: z.number() }),
  z.object({ type: z.literal("status"), message: z.string() }),
  z.object({
    type: z.literal("error"),
    errorMessage: z.string(),
    errorId: z.string().optional(),
    errorCode: z.string().optional(),
    error: streamErrorSchema.optional(),
  }),
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;
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
  return result.success ? result.data : null;
}

export function parseChatResponse(payload: unknown): ChatResponse | null {
  if (!payload || typeof payload !== "object") return null;
  const json = payload as Partial<ChatResponse>;
  if (typeof json.output !== "string") return null;
  if (typeof json.model !== "string" || json.model.trim().length === 0) return null;
  return {
    output: json.output,
    model: json.model,
    modelCalls: typeof json.modelCalls === "number" ? json.modelCalls : undefined,
    toolCalls: Array.isArray((json as { toolCalls?: unknown }).toolCalls)
      ? ((json as { toolCalls?: unknown[] }).toolCalls ?? []).filter((item): item is string => typeof item === "string")
      : undefined,
    usage:
      json.usage &&
      typeof json.usage === "object" &&
      typeof (json.usage as { promptTokens?: unknown }).promptTokens === "number" &&
      typeof (json.usage as { completionTokens?: unknown }).completionTokens === "number" &&
      typeof (json.usage as { totalTokens?: unknown }).totalTokens === "number"
        ? {
            promptTokens: (json.usage as { promptTokens: number }).promptTokens,
            completionTokens: (json.usage as { completionTokens: number }).completionTokens,
            totalTokens: (json.usage as { totalTokens: number }).totalTokens,
            promptBudgetTokens:
              typeof (json.usage as { promptBudgetTokens?: unknown }).promptBudgetTokens === "number"
                ? (json.usage as { promptBudgetTokens: number }).promptBudgetTokens
                : undefined,
            promptTruncated:
              typeof (json.usage as { promptTruncated?: unknown }).promptTruncated === "boolean"
                ? (json.usage as { promptTruncated: boolean }).promptTruncated
                : undefined,
          }
        : undefined,
    budgetWarning: typeof json.budgetWarning === "string" ? json.budgetWarning : undefined,
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
