import { z } from "zod";
import { verifyScopeSchema } from "./api";
import { domainIdSchema } from "./id-contract";
import { providerSchema } from "./provider-contract";
import { sessionIdSchema } from "./session-contract";
import { createId } from "./short-id";
import { streamErrorDetailSchema } from "./stream-error";
import { taskIdSchema, taskRecordSchema } from "./task-contract";

const errorIdSchema = domainIdSchema("err");

// Reserved method names for future background task support.
export const RESERVED_RPC_CLIENT_TASK_METHODS = ["task.start", "task.status", "task.cancel", "task.attach"] as const;
export const RESERVED_RPC_SERVER_TASK_METHODS = ["task.accepted", "task.updated", "task.done", "task.error"] as const;
export const rpcRequestIdSchema = domainIdSchema("rpc");
export type RpcRequestId = z.infer<typeof rpcRequestIdSchema>;

export function createRpcRequestId(): RpcRequestId {
  return rpcRequestIdSchema.parse(`rpc_${createId()}`);
}

const chatRequestSchema = z.object({
  message: z.string(),
  history: z.array(z.unknown()),
  model: z.string(),
  modeModels: z
    .object({
      plan: z.string().optional(),
      work: z.string().optional(),
      verify: z.string().optional(),
    })
    .optional(),
  sessionId: sessionIdSchema.optional(),
  resourceId: z.string().optional(),
  useMemory: z.boolean().optional(),
  verifyScope: verifyScopeSchema.optional(),
  workspace: z.string().optional(),
});

export const statusPayloadSchema = z.object({
  ok: z.literal(true),
  providers: z.array(providerSchema),
  model: z.string(),
  "model.plan": z.string().optional(),
  "model.work": z.string().optional(),
  "model.verify": z.string().optional(),
  protocol_version: z.string(),
  capabilities: z.string(),
  permissions: z.string(),
  service: z.string(),
  memory: z.string(),
  observational_memory: z.string(),
  tasks_total: z.number().int().min(0),
  tasks_running: z.number().int().min(0),
  tasks_detached: z.number().int().min(0),
  rpc_queue_length: z.number().int().min(0),
});

export const rpcClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ id: rpcRequestIdSchema, type: z.literal("status.get") }),
  z.object({
    id: rpcRequestIdSchema,
    type: z.literal("permissions.set"),
    payload: z.object({ mode: z.enum(["read", "write"]) }),
  }),
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
    type: z.literal("permissions.result"),
    permissionMode: z.enum(["read", "write"]),
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
    error: z.string(),
    errorId: errorIdSchema.optional(),
    errorCode: z.string().optional(),
    errorDetail: streamErrorDetailSchema.optional(),
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
