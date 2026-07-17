import { z } from "zod";
import type { ChatRequest, ChatResponse } from "./api";
import { invariant } from "./assert";
import { checklistItemSchema } from "./checklist-contract";
import { rpcServerMessageSchema } from "./rpc-protocol";
import { promptBreakdownSchema, tokenCountSchema, tokenUsageSchema } from "./session-contract";
import { activeSkillSchema, activeSkillsSchema } from "./skill-contract";
import type { StatusFields } from "./status-contract";
import { streamErrorSchema } from "./stream-error";
import type { TaskId, TaskRecord } from "./task-contract";
import { toolOutputPartSchema } from "./tool-output-contract";

export const pendingStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("queued"), position: z.number().int().nonnegative().optional() }),
  z.object({ kind: z.literal("accepted") }),
  z.object({
    kind: z.literal("running"),
    toolCalls: z.number().int().nonnegative().optional(),
  }),
]);
export type PendingState = z.infer<typeof pendingStateSchema>;

export interface ClientOptions {
  apiUrl: string;
  apiKey?: string;
  replyTimeoutMs?: number;
}

const textDeltaEventSchema = z.object({ type: z.literal("text-delta"), text: z.string() });
const reasoningEventSchema = z.object({ type: z.literal("reasoning"), text: z.string() });
const toolCallEventSchema = z.object({
  type: z.literal("tool-call"),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});
const toolOutputEventSchema = z.object({
  type: z.literal("tool-output"),
  toolCallId: z.string(),
  toolName: z.string(),
  content: toolOutputPartSchema,
});
const toolResultEventSchema = z.object({
  type: z.literal("tool-result"),
  toolCallId: z.string(),
  toolName: z.string(),
  isError: z.boolean().optional(),
  errorCode: z.string().optional(),
  error: streamErrorSchema.optional(),
});
const streamUsageEventSchema = z.object({
  type: z.literal("usage"),
  inputTokens: tokenCountSchema,
  outputTokens: tokenCountSchema,
});
const statusEventSchema = z.object({ type: z.literal("status"), state: pendingStateSchema });
const checklistEventSchema = z.object({
  type: z.literal("checklist"),
  groupId: z.string().min(1),
  groupTitle: z.string().min(1),
  items: z.array(checklistItemSchema),
});
const skillActivatedEventSchema = z.object({
  type: z.literal("skill-activated"),
  skill: activeSkillSchema,
});
const errorEventSchema = z.object({
  type: z.literal("error"),
  errorMessage: z.string(),
  errorId: z.string().optional(),
  errorCode: z.string().optional(),
  error: streamErrorSchema.optional(),
});
// Non-fatal diagnostic surfaced in the transcript; distinct from `error` (a task failure).
const noticeEventSchema = z.object({
  type: z.literal("notice"),
  level: z.enum(["warn", "error"]),
  message: z.string(),
  source: z.string().optional(),
});

export const streamEventSchema = z.discriminatedUnion("type", [
  textDeltaEventSchema,
  reasoningEventSchema,
  toolCallEventSchema,
  toolOutputEventSchema,
  toolResultEventSchema,
  streamUsageEventSchema,
  statusEventSchema,
  checklistEventSchema,
  skillActivatedEventSchema,
  errorEventSchema,
  noticeEventSchema,
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;

export interface Client {
  replyStream(input: {
    request: ChatRequest;
    onEvent: (event: StreamEvent) => void;
    signal?: AbortSignal;
  }): Promise<ChatResponse>;
  status(): Promise<StatusFields>;
  taskStatus(input: { taskId: TaskId }): Promise<TaskRecord | null>;
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

const chatResponseSchema = z.object({
  output: z.string(),
  outputStreamed: z.boolean(),
  model: z.string().min(1),
  usage: tokenUsageSchema.optional(),
  promptBreakdown: promptBreakdownSchema.optional(),
  toolCalls: z.array(z.string()).optional(),
  modelCalls: z.number().optional(),
  error: z.string().optional(),
  activeSkills: activeSkillsSchema.optional(),
});
type ChatResponsePayload = z.infer<typeof chatResponseSchema>;

export function parseChatResponse(payload: unknown): ChatResponsePayload | null {
  const result = chatResponseSchema.safeParse(payload);
  return result.success ? result.data : null;
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
