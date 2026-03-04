import { estimateTokens } from "./agent-input";
import type { MemoryCommitContext, MemoryLoadContext, MemorySource } from "./memory-contract";
import { distillMemorySource } from "./memory-source-distill";
import { storedMemorySource } from "./memory-source-stored";

const MEMORY_SOURCES: readonly MemorySource[] = [
  storedMemorySource,
  distillMemorySource,
];

export async function loadMemoryContext(
  ctx: MemoryLoadContext,
  budgetTokens: number,
): Promise<{ prompt: string; tokenEstimate: number }> {
  const parts: string[] = [];
  let used = 0;
  for (const source of MEMORY_SOURCES) {
    const entries = await source.load(ctx);
    for (const entry of entries) {
      const cost = estimateTokens(entry);
      if (used + cost > budgetTokens) break;
      parts.push(entry);
      used += cost;
    }
  }
  if (parts.length === 0) return { prompt: "", tokenEstimate: 0 };
  return {
    prompt: `Memory context:\n${parts.map((p) => `- ${p}`).join("\n")}`,
    tokenEstimate: used,
  };
}

export async function commitMemorySources(ctx: MemoryCommitContext): Promise<void> {
  for (const source of MEMORY_SOURCES) {
    if (source.commit) await source.commit(ctx);
  }
}
