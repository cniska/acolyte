import type { MemorySource } from "./memory-contract";
import { listMemories } from "./memory";

const STORED_MEMORY_LIMIT = 8;

export const storedMemorySource: MemorySource = {
  id: "stored",
  async loadEntries() {
    const entries = await listMemories({ scope: "all" });
    return entries
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, STORED_MEMORY_LIMIT)
      .map((e) => ({ content: e.content }));
  },
};
