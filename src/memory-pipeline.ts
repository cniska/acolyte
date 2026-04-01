import type { MemoryCommitContext, MemoryCommitMetrics, MemorySource } from "./memory-contract";

export async function runMemoryCommitPipeline(
  sources: readonly MemorySource[],
  ctx: MemoryCommitContext,
): Promise<MemoryCommitMetrics> {
  const totals: MemoryCommitMetrics = {
    projectPromotedFacts: 0,
    userPromotedFacts: 0,
    sessionScopedFacts: 0,
    droppedUntaggedFacts: 0,
    observeTokens: 0,
    reflectTokens: 0,
  };
  for (const source of sources) {
    if (!source.commit) continue;
    const metrics = await source.commit(ctx);
    if (!metrics) continue;
    totals.projectPromotedFacts = (totals.projectPromotedFacts ?? 0) + (metrics.projectPromotedFacts ?? 0);
    totals.userPromotedFacts = (totals.userPromotedFacts ?? 0) + (metrics.userPromotedFacts ?? 0);
    totals.sessionScopedFacts = (totals.sessionScopedFacts ?? 0) + (metrics.sessionScopedFacts ?? 0);
    totals.droppedUntaggedFacts = (totals.droppedUntaggedFacts ?? 0) + (metrics.droppedUntaggedFacts ?? 0);
    totals.observeTokens = (totals.observeTokens ?? 0) + (metrics.observeTokens ?? 0);
    totals.reflectTokens = (totals.reflectTokens ?? 0) + (metrics.reflectTokens ?? 0);
  }
  return totals;
}
