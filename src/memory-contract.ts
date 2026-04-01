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
  readonly scope: MemoryScope;
}

export type RemoveMemoryResult = { kind: "removed"; entry: MemoryEntry } | { kind: "not_found"; id: string };

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
  observeTokens?: number;
  reflectTokens?: number;
};

export type MemorySource = {
  readonly id: string;
  commit?(ctx: MemoryCommitContext): Promise<MemoryCommitMetrics | undefined>;
};

export const memoryKindSchema = z.enum(["observation", "reflection", "stored"]);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

export const memoryRecordSchema = z.object({
  id: memoryIdSchema,
  scopeKey: z.string().min(1),
  kind: memoryKindSchema,
  content: z.string().min(1),
  currentTask: z.string().min(1).optional(),
  nextStep: z.string().min(1).optional(),
  createdAt: isoDateTimeSchema,
  tokenEstimate: z.number().int().min(0),
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export interface MemoryStore {
  list(options?: { scopeKey?: string; kind?: MemoryKind }): Promise<readonly MemoryRecord[]>;
  write(record: MemoryRecord, scope?: MemoryScope): Promise<void>;
  remove(id: string): Promise<void>;
  writeEmbedding(id: string, scopeKey: string, embedding: Buffer): void;
  removeEmbedding(id: string): void;
  getEmbedding(id: string): Buffer | null;
  getEmbeddings(ids: string[]): Map<string, Buffer>;
  close(): void;
}

export function scopeFromKey(key: string): MemoryScope {
  if (key.startsWith("sess_")) return "session";
  if (key.startsWith("proj_")) return "project";
  if (key.startsWith("user_")) return "user";
  throw new Error(`Unknown scope key prefix: ${key}`);
}
