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

export type MemoryNormalizeStrategy = (
  sources: readonly MemorySource[],
  ctx: MemoryLoadContext,
) => Promise<MemoryPipelineEntry[]>;

export async function runMemoryPipeline(
  sources: readonly MemorySource[],
  ctx: MemoryLoadContext,
  budgetTokens: number,
  normalizeEntries: MemoryNormalizeStrategy = normalizeMemoryEntries,
  selectEntries: MemorySelectionStrategy = selectMemoryEntries,
): Promise<{ entries: MemoryPipelineEntry[]; tokenEstimate: number }> {
  if (budgetTokens <= 0) return { entries: [], tokenEstimate: 0 };

  const entries = await normalizeEntries(sources, ctx);
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

  const prioritizedEntries = prioritizeContinuationEntries(entries);
  const selected: MemoryPipelineEntry[] = [];
  const seenContentKeys = new Set<string>();
  let used = 0;
  let selectedContinuation = false;
  for (const entry of prioritizedEntries) {
    if (used >= budgetTokens) break;
    if (hasContinuationState(entry.content) && selectedContinuation) continue;
    const contentKey = normalizeContentKey(entry.content);
    if (seenContentKeys.has(contentKey)) continue;
    if (entry.tokenEstimate > budgetTokens - used) continue;
    selected.push(entry);
    seenContentKeys.add(contentKey);
    if (hasContinuationState(entry.content)) selectedContinuation = true;
    used += entry.tokenEstimate;
  }
  return { entries: selected, tokenEstimate: used };
}

function prioritizeContinuationEntries(entries: readonly MemoryPipelineEntry[]): MemoryPipelineEntry[] {
  const continuation: MemoryPipelineEntry[] = [];
  const other: MemoryPipelineEntry[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (hasContinuationState(entry.content)) continuation.push(entry);
    else other.push(entry);
  }
  return [...continuation, ...other.reverse()];
}

function hasContinuationState(content: string): boolean {
  return /(^|\n)\s*Current task:/i.test(content) || /(^|\n)\s*Next step:/i.test(content);
}

function normalizeContentKey(content: string): string {
  return content.trim();
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
