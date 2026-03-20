import { estimateTokens } from "./agent-input";
import type { MemoryCommitContext, MemoryCommitMetrics, MemoryLoadContext, MemorySource } from "./memory-contract";
import type { DistillStore } from "./memory-distill-store";
import { bufferToEmbedding, cosineSimilarity, embedText } from "./memory-embedding";

export type MemoryPipelineEntry = {
  sourceId: string;
  content: string;
  tokenEstimate: number;
  isContinuation?: boolean;
  recordId?: string;
};

export type MemorySelectionStrategy = (
  entries: readonly MemoryPipelineEntry[],
  budgetTokens: number,
  ctx?: MemoryLoadContext,
) => Promise<{ entries: MemoryPipelineEntry[]; tokenEstimate: number }>;

export type MemoryNormalizeStrategy = (
  sources: readonly MemorySource[],
  ctx: MemoryLoadContext,
) => Promise<MemoryPipelineEntry[]>;

export async function runMemoryPipeline(
  sources: readonly MemorySource[],
  ctx: MemoryLoadContext,
  budgetTokens: number,
  normalizeEntries: MemoryNormalizeStrategy = normalizeMemoryEntries,
  selectEntries: MemorySelectionStrategy = selectMemoryEntriesSemantic,
): Promise<{ entries: MemoryPipelineEntry[]; tokenEstimate: number }> {
  if (budgetTokens <= 0) return { entries: [], tokenEstimate: 0 };

  const entries = await normalizeEntries(sources, ctx);
  return selectEntries(entries, budgetTokens, ctx);
}

export async function normalizeMemoryEntries(
  sources: readonly MemorySource[],
  ctx: MemoryLoadContext,
): Promise<MemoryPipelineEntry[]> {
  const entries: MemoryPipelineEntry[] = [];
  for (const source of sources) {
    const loadedEntries = await source.loadEntries(ctx);
    for (const entry of loadedEntries) {
      const content = entry.content.trim();
      if (content.length === 0) continue;
      entries.push({
        sourceId: source.id,
        content,
        tokenEstimate: estimateTokens(content),
        isContinuation: entry.isContinuation,
        recordId: entry.recordId,
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
    if (entry.isContinuation && selectedContinuation) continue;
    const contentKey = normalizeContentKey(entry.content);
    if (seenContentKeys.has(contentKey)) continue;
    if (entry.tokenEstimate > budgetTokens - used) continue;
    selected.push(entry);
    seenContentKeys.add(contentKey);
    if (entry.isContinuation) selectedContinuation = true;
    used += entry.tokenEstimate;
  }
  return { entries: selected, tokenEstimate: used };
}

let defaultStoreRef: DistillStore | null = null;

export function setDefaultStoreForSelection(store: DistillStore | null): void {
  defaultStoreRef = store;
}

export async function selectMemoryEntriesSemantic(
  entries: readonly MemoryPipelineEntry[],
  budgetTokens: number,
  ctx?: MemoryLoadContext,
): Promise<{ entries: MemoryPipelineEntry[]; tokenEstimate: number }> {
  if (budgetTokens <= 0) return { entries: [], tokenEstimate: 0 };
  if (!ctx?.query || !defaultStoreRef) return selectMemoryEntries(entries, budgetTokens);

  const queryEmbedding = await embedText(ctx.query);
  if (!queryEmbedding) return selectMemoryEntries(entries, budgetTokens);

  const continuation: MemoryPipelineEntry[] = [];
  const nonContinuation: MemoryPipelineEntry[] = [];

  for (const entry of entries) {
    if (entry.isContinuation) continuation.push(entry);
    else nonContinuation.push(entry);
  }

  const recordIds = nonContinuation.map((e) => e.recordId).filter((id): id is string => id !== undefined);
  const embeddingMap = defaultStoreRef.getEmbeddings(recordIds);

  const scorable = nonContinuation.map((entry) => {
    let score = 0;
    if (entry.recordId) {
      const buf = embeddingMap.get(entry.recordId);
      if (buf) score = cosineSimilarity(queryEmbedding, bufferToEmbedding(buf));
    }
    return { entry, score };
  });

  scorable.sort((a, b) => b.score - a.score);

  const selected: MemoryPipelineEntry[] = [];
  const seenContentKeys = new Set<string>();
  let used = 0;
  let selectedContinuation = false;

  for (const entry of continuation.reverse()) {
    if (selectedContinuation) continue;
    if (entry.tokenEstimate > budgetTokens - used) continue;
    selected.push(entry);
    seenContentKeys.add(normalizeContentKey(entry.content));
    selectedContinuation = true;
    used += entry.tokenEstimate;
  }

  for (const { entry } of scorable) {
    if (used >= budgetTokens) break;
    const contentKey = normalizeContentKey(entry.content);
    if (seenContentKeys.has(contentKey)) continue;
    if (entry.tokenEstimate > budgetTokens - used) continue;
    selected.push(entry);
    seenContentKeys.add(contentKey);
    used += entry.tokenEstimate;
  }

  return { entries: selected, tokenEstimate: used };
}

function prioritizeContinuationEntries(entries: readonly MemoryPipelineEntry[]): MemoryPipelineEntry[] {
  const continuation: MemoryPipelineEntry[] = [];
  const other: MemoryPipelineEntry[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.isContinuation) continuation.push(entry);
    else other.push(entry);
  }
  return [...continuation, ...other.reverse()];
}

function normalizeContentKey(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function runMemoryCommitPipeline(
  sources: readonly MemorySource[],
  ctx: MemoryCommitContext,
): Promise<MemoryCommitMetrics> {
  const totals: MemoryCommitMetrics = {
    projectPromotedFacts: 0,
    userPromotedFacts: 0,
    sessionScopedFacts: 0,
    droppedUntaggedFacts: 0,
  };
  for (const source of sources) {
    if (!source.commit) continue;
    const metrics = await source.commit(ctx);
    if (!metrics) continue;
    totals.projectPromotedFacts = (totals.projectPromotedFacts ?? 0) + (metrics.projectPromotedFacts ?? 0);
    totals.userPromotedFacts = (totals.userPromotedFacts ?? 0) + (metrics.userPromotedFacts ?? 0);
    totals.sessionScopedFacts = (totals.sessionScopedFacts ?? 0) + (metrics.sessionScopedFacts ?? 0);
    totals.droppedUntaggedFacts = (totals.droppedUntaggedFacts ?? 0) + (metrics.droppedUntaggedFacts ?? 0);
  }
  return totals;
}

export function formatMemoryContextPrompt(entries: readonly MemoryPipelineEntry[]): string {
  if (entries.length === 0) return "";
  return `Memory context:\n${entries.map((entry) => `- ${formatMemoryEntry(entry.content)}`).join("\n")}`;
}

function formatMemoryEntry(content: string): string {
  const trimmed = content.trim();
  return trimmed.replace(/\n/g, "\n  ");
}
