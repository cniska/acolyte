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

export function parseStatusFields(payload: unknown): StatusFields | null {
  const result = statusPayloadSchema.safeParse(payload);
  if (!result.success) return null;
  const fields: StatusFields = {};
  for (const [key, value] of Object.entries(result.data)) {
    if (key === "ok") continue;
    if (typeof value === "string" || typeof value === "number") fields[key] = value;
    else if (Array.isArray(value)) fields[key] = value;
  }
  return fields;
}
