import { z } from "zod";
import { isoDateTimeSchema } from "./datetime";
import { domainIdSchema } from "./id-contract";
import type { ResourceId } from "./resource-id";

// -- Source interface --

export type MemoryLoadContext = {
  readonly sessionId?: string;
  readonly resourceId?: ResourceId;
  readonly workspace?: string;
};

export type MemorySourceEntry = {
  readonly content: string;
  readonly isContinuation?: boolean;
};

export type MemoryCommitContext = MemoryLoadContext & {
  readonly messages: readonly { role: string; content: string }[];
  readonly output: string;
};

export type MemoryCommitMetrics = {
  projectPromotedFacts?: number;
  userPromotedFacts?: number;
  sessionScopedFacts?: number;
  droppedUntaggedFacts?: number;
};

export type MemorySource = {
  readonly id: string;
  loadEntries(ctx: MemoryLoadContext): Promise<readonly MemorySourceEntry[]>;
  commit?(ctx: MemoryCommitContext): Promise<MemoryCommitMetrics | void>;
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
  currentTask: z.string().min(1).optional(),
  nextStep: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
  tokenEstimate: z.number().int().min(0),
});
export type DistillRecord = z.infer<typeof distillRecordSchema>;
