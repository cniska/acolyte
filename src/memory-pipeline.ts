import { estimateTokens } from "./agent-input";
import type { MemoryCommitContext, MemoryLoadContext, MemorySource } from "./memory-contract";

export type MemoryPipelineEntry = {
  sourceId: string;
  content: string;
  tokenEstimate: number;
  isContinuation?: boolean;
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
    const loadedEntries =
      source.loadEntries
        ? await source.loadEntries(ctx)
        : (await source.load(ctx)).map((content) => ({ content, isContinuation: false }));
    for (const entry of loadedEntries) {
      const content = entry.content;
      if (content.trim().length === 0) continue;
      entries.push({
        sourceId: source.id,
        content,
        tokenEstimate: estimateTokens(content),
        isContinuation: entry.isContinuation,
      });
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
    if (isContinuationEntry(entry) && selectedContinuation) continue;
    const contentKey = normalizeContentKey(entry.content);
    if (seenContentKeys.has(contentKey)) continue;
    if (entry.tokenEstimate > budgetTokens - used) continue;
    selected.push(entry);
    seenContentKeys.add(contentKey);
    if (isContinuationEntry(entry)) selectedContinuation = true;
    used += entry.tokenEstimate;
  }
  return { entries: selected, tokenEstimate: used };
}

function prioritizeContinuationEntries(entries: readonly MemoryPipelineEntry[]): MemoryPipelineEntry[] {
  const continuation: MemoryPipelineEntry[] = [];
  const other: MemoryPipelineEntry[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (isContinuationEntry(entry)) continuation.push(entry);
    else other.push(entry);
  }
  return [...continuation, ...other.reverse()];
}

function isContinuationEntry(entry: MemoryPipelineEntry): boolean {
  if (entry.isContinuation === true) return true;
  return hasContinuationState(entry.content);
}

function hasContinuationState(content: string): boolean {
  return /(^|\n)\s*(?:[-*]\s*)?Current task:/i.test(content) || /(^|\n)\s*(?:[-*]\s*)?Next step:/i.test(content);
}

function normalizeContentKey(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
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
