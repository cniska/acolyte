import { z } from "zod";
import { verifyScopeSchema } from "./api";
import { streamErrorDetailSchema } from "./stream-error";
import { taskRecordSchema } from "./task-state";

// Reserved method names for future background task support.
export const RESERVED_RPC_CLIENT_TASK_METHODS = ["task.start", "task.status", "task.cancel", "task.attach"] as const;
export const RESERVED_RPC_SERVER_TASK_METHODS = ["task.accepted", "task.updated", "task.done", "task.error"] as const;

const chatRequestSchema = z.object({
  message: z.string(),
  history: z.array(z.unknown()),
  model: z.string(),
  sessionId: z.string().optional(),
  resourceId: z.string().optional(),
  useMemory: z.boolean().optional(),
  skipAutoVerify: z.boolean().optional(),
  verifyScope: verifyScopeSchema.optional(),
  workspace: z.string().optional(),
});

export const statusPayloadSchema = z.object({
  ok: z.literal(true),
  provider: z.string(),
  model: z.string(),
  protocolVersion: z.string(),
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
  z.object({ id: z.string().min(1), type: z.literal("status.get") }),
  z.object({
    id: z.string().min(1),
    type: z.literal("permissions.set"),
    payload: z.object({ mode: z.enum(["read", "write"]) }),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("chat.start"),
    payload: z.object({ request: chatRequestSchema }),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("chat.abort"),
    payload: z.object({ requestId: z.string().min(1) }),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("task.status"),
    payload: z.object({ taskId: z.string().min(1) }),
  }),
]);

export const rpcServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("status.result"),
    status: statusPayloadSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("permissions.result"),
    permissionMode: z.enum(["read", "write"]),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("chat.event"),
    event: z.unknown(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("chat.accepted"),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("chat.queued"),
    position: z.number().int().min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("chat.started"),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("chat.done"),
    reply: z.unknown(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("chat.error"),
    error: z.string(),
    errorCode: z.string().optional(),
    errorDetail: streamErrorDetailSchema.optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("chat.abort.result"),
    requestId: z.string().min(1),
    aborted: z.boolean(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("task.status.result"),
    task: taskRecordSchema.nullable(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("error"),
    error: z.string(),
  }),
]);

export type RpcClientMessage = z.infer<typeof rpcClientMessageSchema>;
export type RpcServerMessage = z.infer<typeof rpcServerMessageSchema>;
