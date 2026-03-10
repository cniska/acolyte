import type { MemoryEntry, MemoryScope, RemoveMemoryResult } from "./memory-contract";

export interface MemoryStore {
  list(scope?: MemoryScope | "all"): Promise<MemoryEntry[]>;
  add(content: string, scope?: MemoryScope): Promise<MemoryEntry>;
  remove(prefix: string, scope?: MemoryScope | "all"): Promise<RemoveMemoryResult>;
}
