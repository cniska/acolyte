import { z } from "zod";
import { verifyScopeSchema } from "./api";
import { errorIdSchema } from "./error-handling";
import { domainIdSchema } from "./id-contract";
import { providerSchema } from "./provider-contract";
import { resourceIdSchema } from "./resource-id";
import { sessionIdSchema } from "./session-contract";
import { createId } from "./short-id";
import { streamErrorSchema } from "./stream-error";
import { taskIdSchema, taskRecordSchema } from "./task-contract";
export const rpcRequestIdSchema = domainIdSchema("rpc");
export type RpcRequestId = z.infer<typeof rpcRequestIdSchema>;

export function createRpcRequestId(): RpcRequestId {
  return rpcRequestIdSchema.parse(`rpc_${createId()}`);
}

const chatRequestSchema = z.object({
  message: z.string().max(100_000),
  history: z.array(z.unknown()).max(500),
  model: z.string().max(200),
  modeModels: z
    .object({
      work: z.string().max(200).optional(),
      verify: z.string().max(200).optional(),
    })
    .optional(),
  sessionId: sessionIdSchema.optional(),
  resourceId: resourceIdSchema.optional(),
  useMemory: z.boolean().optional(),
  verifyScope: verifyScopeSchema.optional(),
  workspace: z.string().max(4096).optional(),
});

export const statusPayloadSchema = z
  .object({
    ok: z.literal(true),
    providers: z.array(providerSchema),
    model: z.string(),
    "model.work": z.string().optional(),
    "model.verify": z.string().optional(),
    protocol_version: z.string(),
    capabilities: z.string(),
    permissions: z.string(),
    service: z.string(),
    memory: z.string(),
    tasks_total: z.number().int().min(0),
    tasks_running: z.number().int().min(0),
    tasks_detached: z.number().int().min(0),
    rpc_queue_length: z.number().int().min(0),
  })
  .catchall(z.union([z.boolean(), z.string(), z.number(), z.array(z.string())]));

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
