import { estimateTokens } from "./agent-input";
import type { MemoryCommitContext, MemoryLoadContext, MemorySource } from "./memory-contract";
import { distillMemorySource } from "./memory-source-distill";
import { storedMemorySource } from "./memory-source-stored";

const MEMORY_SOURCES: readonly MemorySource[] = [storedMemorySource, distillMemorySource];

export async function loadMemoryContext(
  ctx: MemoryLoadContext,
  budgetTokens: number,
): Promise<{ prompt: string; tokenEstimate: number }> {
  if (budgetTokens <= 0) return { prompt: "", tokenEstimate: 0 };
  const parts: string[] = [];
  let used = 0;
  for (const source of MEMORY_SOURCES) {
    if (used >= budgetTokens) break;
    const entries = await source.load(ctx);
    for (const entry of entries) {
      const cost = estimateTokens(entry);
      if (cost > budgetTokens - used) continue;
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
