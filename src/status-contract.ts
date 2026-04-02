import { z } from "zod";
import { providerSchema } from "./provider-contract";

export const statusPayloadSchema = z
  .object({
    ok: z.literal(true),
    providers: z.array(providerSchema),
    model: z.string(),
    protocol_version: z.string(),
    capabilities: z.string(),
    service: z.string(),
    tasks_total: z.number().int().min(0),
    tasks_running: z.number().int().min(0),
    tasks_detached: z.number().int().min(0),
    rpc_queue_length: z.number().int().min(0),
  })
  .catchall(z.union([z.boolean(), z.string(), z.number(), z.array(z.string())]));

export type StatusFields = Record<string, string | number | string[]>;
export type StatusPayload = z.infer<typeof statusPayloadSchema>;
