import { z } from "zod";
import type { IsoDateTimeString } from "./datetime";
import { isoDateTimeSchema } from "./datetime";
import { domainIdSchema } from "./id-contract";
import type { ResourceId } from "./resource-id";

export const memoryScopeSchema = z.enum(["user", "project", "session"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export const memoryIdSchema = domainIdSchema("mem");
export type MemoryId = z.infer<typeof memoryIdSchema>;

export interface MemoryEntry {
  readonly id: MemoryId;
  readonly content: string;
  readonly createdAt: IsoDateTimeString;
  readonly lastRecalledAt: IsoDateTimeString | null;
  readonly scope: MemoryScope;
}

export type RemoveMemoryResult = { kind: "removed"; entry: MemoryEntry } | { kind: "not_found"; id: string };

export type MemoryCommitContext = {
  readonly sessionId?: string;
  readonly resourceId?: ResourceId;
  readonly workspace?: string;
  readonly messages: readonly { role: string; content: string }[];
  readonly output: string;
};

export type MemoryCommitMetrics = {
  projectPromotedFacts?: number;
  userPromotedFacts?: number;
  sessionScopedFacts?: number;
  droppedUntaggedFacts?: number;
  distillTokens?: number;
};

export type MemoryPolicy = {
  messageThreshold: number;
  maxOutputTokens: number;
  contextMessageWindow: number;
  malformedStreakWarningThreshold: number;
  cosineWeight: number;
  tokenWeight: number;
};

export const defaultMemoryPolicy: MemoryPolicy = {
  messageThreshold: 4,
  maxOutputTokens: 1_000,
  contextMessageWindow: 20,
  malformedStreakWarningThreshold: 3,
  cosineWeight: 0.8,
  tokenWeight: 0.2,
};

export function createMemoryPolicy(override?: Partial<MemoryPolicy>): MemoryPolicy {
  if (!override) return defaultMemoryPolicy;
  return { ...defaultMemoryPolicy, ...override };
}

export interface MemoryDistiller {
  commit(ctx: MemoryCommitContext): Promise<MemoryCommitMetrics | undefined>;
}

export const memoryKindSchema = z.enum(["observation", "stored"]);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

export const memoryRecordSchema = z.object({
  id: memoryIdSchema,
  scopeKey: z.string().min(1),
  kind: memoryKindSchema,
  content: z.string().min(1),
  createdAt: isoDateTimeSchema,
  tokenEstimate: z.number().int().min(0),
  lastRecalledAt: isoDateTimeSchema.nullable().optional(),
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export interface MemoryStore {
  list(options?: { scopeKey?: string; kind?: MemoryKind }): Promise<readonly MemoryRecord[]>;
  write(record: MemoryRecord, scope?: MemoryScope): Promise<void>;
  remove(id: string): Promise<void>;
  touchRecalled(ids: string[]): Promise<void>;
  writeEmbedding(id: string, scopeKey: string, embedding: Buffer): Promise<void>;
  removeEmbedding(id: string): Promise<void>;
  getEmbedding(id: string): Promise<Buffer | null>;
  getEmbeddings(ids: string[]): Promise<Map<string, Buffer>>;
  searchByEmbedding?(
    queryEmbedding: Float32Array,
    options: { scopeKey?: string; kind?: MemoryKind; limit: number },
  ): Promise<MemoryRecord[]>;
  close(): void;
}

export function safeScopeKey(scope: string): string | null {
  return /^(sess|user|proj)_[a-z0-9]+$/.test(scope) ? scope : null;
}

export function scopeFromKey(key: string): MemoryScope {
  if (key.startsWith("sess_")) return "session";
  if (key.startsWith("proj_")) return "project";
  if (key.startsWith("user_")) return "user";
  throw new Error(`Unknown scope key prefix: ${key}`);
}
