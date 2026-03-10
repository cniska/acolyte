import type { z } from "zod";
import type { statusPayloadSchema } from "./rpc-protocol";

export type StatusFields = Record<string, string | number | string[]>;
export type StatusPayload = z.infer<typeof statusPayloadSchema>;
