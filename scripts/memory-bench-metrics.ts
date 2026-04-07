import { average } from "./perf-test-utils";

export type QueryResult = {
  queryId: string;
  question: string;
  retrievedIds: string[];
  relevantIds: string[];
  recallAtK: Record<number, number>;
  ndcgAtK: Record<number, number>;
};

export type AggregateMetrics = {
  recallAtK: Record<number, number>;
  ndcgAtK: Record<number, number>;
};

export function recallAtK(retrieved: string[], relevant: ReadonlySet<string>, k: number): number {
  if (relevant.size === 0) return 0;
  let hits = 0;
  const n = Math.min(k, retrieved.length);
  for (let i = 0; i < n; i++) {
    if (relevant.has(retrieved[i])) hits++;
  }
  return hits / relevant.size;
}

function dcgAtK(retrieved: string[], relevanceMap: ReadonlyMap<string, number>, k: number): number {
  let dcg = 0;
  const n = Math.min(k, retrieved.length);
  for (let i = 0; i < n; i++) {
    const rel = relevanceMap.get(retrieved[i]) ?? 0;
    dcg += rel / Math.log2(i + 2);
  }
  return dcg;
}

export function ndcgAtK(retrieved: string[], relevanceMap: ReadonlyMap<string, number>, k: number): number {
  const dcg = dcgAtK(retrieved, relevanceMap, k);
  if (dcg === 0) return 0;
  const idealRanking = [...relevanceMap.values()].sort((a, b) => b - a);
  let idcg = 0;
  const n = Math.min(k, idealRanking.length);
  for (let i = 0; i < n; i++) {
    idcg += idealRanking[i] / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

export function computeQueryMetrics(
  retrieved: string[],
  relevant: string[],
  kValues: number[],
  relevanceGrades?: ReadonlyMap<string, number>,
): { recallAtK: Record<number, number>; ndcgAtK: Record<number, number> } {
  const relevantSet = new Set(relevant);
  const gradeMap = relevanceGrades ?? new Map(relevant.map((id) => [id, 1]));
  const recall: Record<number, number> = {};
  const ndcg: Record<number, number> = {};
  for (const k of kValues) {
    recall[k] = recallAtK(retrieved, relevantSet, k);
    ndcg[k] = ndcgAtK(retrieved, gradeMap, k);
  }
  return { recallAtK: recall, ndcgAtK: ndcg };
}

export function aggregateMetrics(queryResults: readonly QueryResult[], kValues: number[]): AggregateMetrics {
  const recall: Record<number, number> = {};
  const ndcg: Record<number, number> = {};
  for (const k of kValues) {
    recall[k] = average(queryResults.map((q) => q.recallAtK[k] ?? 0));
    ndcg[k] = average(queryResults.map((q) => q.ndcgAtK[k] ?? 0));
  }
  return { recallAtK: recall, ndcgAtK: ndcg };
}
