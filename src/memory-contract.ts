import { z } from "zod";
import type { IsoDateTimeString } from "./datetime";
import { isoDateTimeSchema } from "./datetime";
import { domainIdSchema } from "./id-contract";
import type { ResourceId } from "./resource-id";

export type MemoryScope = "user" | "project";
export const memoryIdSchema = domainIdSchema("mem");
export type MemoryId = z.infer<typeof memoryIdSchema>;

export interface MemoryEntry {
  readonly id: MemoryId;
  readonly content: string;
  readonly createdAt: IsoDateTimeString;
  readonly scope: MemoryScope;
}

export type RemoveMemoryResult =
  | { kind: "removed"; entry: MemoryEntry }
  | { kind: "not_found"; prefix: string }
  | { kind: "ambiguous"; prefix: string; matches: MemoryEntry[] };

export type MemoryLoadContext = {
  readonly sessionId?: string;
  readonly resourceId?: ResourceId;
  readonly workspace?: string;
  readonly query?: string;
};

export type MemorySourceEntry = {
  readonly content: string;
  readonly isContinuation?: boolean;
  readonly recordId?: string;
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
  commit?(ctx: MemoryCommitContext): Promise<MemoryCommitMetrics | undefined>;
};

export const distillIdSchema = domainIdSchema("dst");
export type DistillId = z.infer<typeof distillIdSchema>;

export const memoryKindSchema = z.enum(["observation", "reflection", "stored"]);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

export const memoryRecordSchema = z.object({
  id: distillIdSchema,
  sessionId: z.string().min(1),
  kind: memoryKindSchema,
  content: z.string().min(1),
  currentTask: z.string().min(1).optional(),
  nextStep: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
  tokenEstimate: z.number().int().min(0),
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export interface MemoryStore {
  list(options?: { scope?: string; kind?: MemoryKind }): Promise<readonly MemoryRecord[]>;
  write(record: MemoryRecord, scope?: string): Promise<void>;
  remove(id: string): Promise<void>;
  writeEmbedding(id: string, scope: string, embedding: Buffer): void;
  removeEmbedding(id: string): void;
  getEmbedding(id: string): Buffer | null;
  getEmbeddings(ids: string[]): Map<string, Buffer>;
  close(): void;
}
