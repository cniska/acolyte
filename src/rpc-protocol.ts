import { z } from "zod";
import { errorIdSchema } from "./error-handling";
import { domainIdSchema } from "./id-contract";
import { resourceIdSchema } from "./resource-id";
import { activeSkillSchema, sessionIdSchema } from "./session-contract";
import { createId } from "./short-id";
import { statusPayloadSchema } from "./status-contract";
import { streamErrorSchema } from "./stream-error";
import { taskIdSchema, taskRecordSchema } from "./task-contract";
export const rpcRequestIdSchema = domainIdSchema("rpc");
export type RpcRequestId = z.infer<typeof rpcRequestIdSchema>;

export function createRpcRequestId(): RpcRequestId {
  return rpcRequestIdSchema.parse(`rpc_${createId()}`);
}

const chatRequestSchema = z
  .object({
    message: z.string().max(100_000),
    history: z.array(z.unknown()).max(500),
    model: z.string().max(200),
    sessionId: sessionIdSchema.optional(),
    resourceId: resourceIdSchema.optional(),
    activeSkills: z.array(activeSkillSchema).optional(),
    useMemory: z.boolean().optional(),
    workspace: z.string().max(4096).optional(),
  })
  .strict();

export const rpcClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ id: rpcRequestIdSchema, type: z.literal("status.get") }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("chat.start"),
    payload: z.object({ request: chatRequestSchema }),
  }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("chat.abort"),
    payload: z.object({ requestId: rpcRequestIdSchema }),
  }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("task.status"),
    payload: z.object({ taskId: taskIdSchema }),
  }),
]);

export const rpcServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("status.result"),
    status: statusPayloadSchema,
  }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("chat.event"),
    event: z.unknown(),
  }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("chat.accepted"),
    taskId: taskIdSchema,
  }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("chat.queued"),
    position: z.number().int().min(1),
  }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("chat.started"),
  }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("chat.done"),
    reply: z.unknown(),
  }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("chat.error"),
    errorMessage: z.string(),
    errorId: errorIdSchema.optional(),
    errorCode: z.string().optional(),
    error: streamErrorSchema.optional(),
  }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("chat.abort.result"),
    requestId: rpcRequestIdSchema,
    aborted: z.boolean(),
  }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("task.status.result"),
    task: taskRecordSchema.nullable(),
  }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("error"),
    error: z.string(),
  }),
]);

export type RpcClientMessage = z.infer<typeof rpcClientMessageSchema>;
export type RpcServerMessage = z.infer<typeof rpcServerMessageSchema>;
