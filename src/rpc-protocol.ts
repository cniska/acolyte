import { z } from "zod";
import { streamErrorDetailSchema } from "./stream-error";

const chatRequestSchema = z.object({
  message: z.string(),
  history: z.array(z.unknown()),
  model: z.string(),
  sessionId: z.string().optional(),
  resourceId: z.string().optional(),
  useMemory: z.boolean().optional(),
  workspace: z.string().optional(),
});

const statusPayloadSchema = z.object({
  ok: z.literal(true),
  provider: z.string(),
  model: z.string(),
  protocolVersion: z.string(),
  capabilities: z.string(),
  permissions: z.string(),
  service: z.string(),
  memory: z.string(),
  observational_memory: z.string(),
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
    type: z.literal("error"),
    error: z.string(),
  }),
]);

export type RpcClientMessage = z.infer<typeof rpcClientMessageSchema>;
export type RpcServerMessage = z.infer<typeof rpcServerMessageSchema>;
