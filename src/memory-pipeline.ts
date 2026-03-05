import { estimateTokens } from "./agent-input";
import type { MemoryLoadContext, MemorySource } from "./memory-contract";

export type MemoryPipelineEntry = {
  sourceId: string;
  content: string;
  tokenEstimate: number;
};

export async function runMemoryPipeline(
  sources: readonly MemorySource[],
  ctx: MemoryLoadContext,
  budgetTokens: number,
): Promise<{ entries: MemoryPipelineEntry[]; tokenEstimate: number }> {
  if (budgetTokens <= 0) return { entries: [], tokenEstimate: 0 };

  const entries: MemoryPipelineEntry[] = [];
  let used = 0;
  for (const source of sources) {
    if (used >= budgetTokens) break;
    const loaded = await source.load(ctx);
    for (const content of loaded) {
      const tokenEstimate = estimateTokens(content);
      if (tokenEstimate > budgetTokens - used) continue;
      entries.push({ sourceId: source.id, content, tokenEstimate });
      used += tokenEstimate;
    }
  }
  return { entries, tokenEstimate: used };
}

export function buildMemoryContextPrompt(entries: readonly MemoryPipelineEntry[]): string {
  if (entries.length === 0) return "";
  return `Memory context:\n${entries.map((entry) => `- ${entry.content}`).join("\n")}`;
}
