import { estimateTokens } from "./agent-input";
import type { MemoryCommitContext, MemoryLoadContext, MemorySource } from "./memory-contract";

export type MemoryPipelineEntry = {
  sourceId: string;
  content: string;
  tokenEstimate: number;
};

export type MemorySelectionStrategy = (
  entries: readonly MemoryPipelineEntry[],
  budgetTokens: number,
) => { entries: MemoryPipelineEntry[]; tokenEstimate: number };

export async function runMemoryPipeline(
  sources: readonly MemorySource[],
  ctx: MemoryLoadContext,
  budgetTokens: number,
  selectEntries: MemorySelectionStrategy = selectMemoryEntries,
): Promise<{ entries: MemoryPipelineEntry[]; tokenEstimate: number }> {
  if (budgetTokens <= 0) return { entries: [], tokenEstimate: 0 };

  const entries = await normalizeMemoryEntries(sources, ctx);
  return selectEntries(entries, budgetTokens);
}

export async function normalizeMemoryEntries(
  sources: readonly MemorySource[],
  ctx: MemoryLoadContext,
): Promise<MemoryPipelineEntry[]> {
  const entries: MemoryPipelineEntry[] = [];
  for (const source of sources) {
    const loaded = await source.load(ctx);
    for (const content of loaded) {
      entries.push({ sourceId: source.id, content, tokenEstimate: estimateTokens(content) });
    }
  }
  return entries;
}

export function selectMemoryEntries(
  entries: readonly MemoryPipelineEntry[],
  budgetTokens: number,
): { entries: MemoryPipelineEntry[]; tokenEstimate: number } {
  if (budgetTokens <= 0) return { entries: [], tokenEstimate: 0 };

  const selected: MemoryPipelineEntry[] = [];
  let used = 0;
  for (const entry of entries) {
    if (used >= budgetTokens) break;
    if (entry.tokenEstimate > budgetTokens - used) continue;
    selected.push(entry);
    used += entry.tokenEstimate;
  }
  return { entries: selected, tokenEstimate: used };
}

export async function runMemoryCommitPipeline(
  sources: readonly MemorySource[],
  ctx: MemoryCommitContext,
): Promise<void> {
  for (const source of sources) {
    if (!source.commit) continue;
    await source.commit(ctx);
  }
}

export function buildMemoryContextPrompt(entries: readonly MemoryPipelineEntry[]): string {
  if (entries.length === 0) return "";
  return `Memory context:\n${entries.map((entry) => `- ${entry.content}`).join("\n")}`;
}
