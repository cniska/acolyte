import { z } from "zod";
import { isoDateTimeSchema } from "./datetime";
import { domainIdSchema } from "./id-contract";

// -- Source interface --

export type MemoryLoadContext = {
  readonly sessionId?: string;
  readonly resourceId?: string;
  readonly workspace?: string;
};

export type MemoryCommitContext = MemoryLoadContext & {
  readonly messages: readonly { role: string; content: string }[];
  readonly output: string;
};

export type MemorySource = {
  readonly id: string;
  load(ctx: MemoryLoadContext): Promise<readonly string[]>;
  commit?(ctx: MemoryCommitContext): Promise<void>;
};

// -- Distill storage types --

export const distillIdSchema = domainIdSchema("dst");
export type DistillId = z.infer<typeof distillIdSchema>;

export const distillTierSchema = z.enum(["observation", "reflection"]);
export type DistillTier = z.infer<typeof distillTierSchema>;

export const distillRecordSchema = z.object({
  id: distillIdSchema,
  sessionId: z.string().min(1),
  tier: distillTierSchema,
  content: z.string().min(1),
  createdAt: isoDateTimeSchema,
  tokenEstimate: z.number().int().min(0),
});
export type DistillRecord = z.infer<typeof distillRecordSchema>;
