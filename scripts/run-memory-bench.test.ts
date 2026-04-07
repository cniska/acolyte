import { describe, expect, test } from "bun:test";
import { aggregateMetrics, computeQueryMetrics, ndcgAtK, recallAtK } from "./memory-bench-metrics";
import { parseDatasetId } from "./memory-bench-scenarios";
import { parseArgs } from "./run-memory-bench";

describe("parseArgs", () => {
  test("applies defaults", () => {
    expect(parseArgs([])).toEqual({
      datasets: ["longmemeval", "locomo", "locomo-observations"],
      kValues: [3, 5, 10],
      limit: null,
      embeddingModel: null,
      json: false,
    });
  });

  test("parses explicit flags", () => {
    expect(
      parseArgs([
        "--dataset",
        "longmemeval",
        "--k",
        "5",
        "--k",
        "20",
        "--limit",
        "10",
        "--embedding-model",
        "text-embedding-3-large",
        "--json",
      ]),
    ).toEqual({
      datasets: ["longmemeval"],
      kValues: [5, 20],
      limit: 10,
      embeddingModel: "text-embedding-3-large",
      json: true,
    });
  });

  test("rejects unknown flags", () => {
    expect(() => parseArgs(["--verbose"])).toThrow("Unknown argument: --verbose");
  });
});

describe("parseDatasetId", () => {
  test("accepts valid ids", () => {
    expect(parseDatasetId("longmemeval")).toBe("longmemeval");
    expect(parseDatasetId("locomo")).toBe("locomo");
    expect(parseDatasetId("locomo-observations")).toBe("locomo-observations");
  });

  test("rejects unknown id", () => {
    expect(() => parseDatasetId("unknown")).toThrow("Unknown dataset: unknown");
  });
});

describe("recallAtK", () => {
  test("perfect recall", () => {
    expect(recallAtK(["a", "b", "c"], new Set(["a", "b"]), 3)).toBe(1);
  });

  test("partial recall", () => {
    expect(recallAtK(["a", "b", "c"], new Set(["a", "c", "d"]), 3)).toBeCloseTo(2 / 3);
  });

  test("no hits", () => {
    expect(recallAtK(["a", "b"], new Set(["x", "y"]), 2)).toBe(0);
  });

  test("k smaller than retrieved", () => {
    expect(recallAtK(["a", "b", "c"], new Set(["c"]), 2)).toBe(0);
  });

  test("empty relevant set returns 0", () => {
    expect(recallAtK(["a", "b"], new Set(), 2)).toBe(0);
  });

  test("k larger than retrieved", () => {
    expect(recallAtK(["a"], new Set(["a", "b"]), 5)).toBe(0.5);
  });
});

describe("ndcgAtK", () => {
  test("perfect ranking with binary relevance", () => {
    const relevance = new Map([
      ["a", 1],
      ["b", 1],
    ]);
    expect(ndcgAtK(["a", "b", "c"], relevance, 3)).toBeCloseTo(1);
  });

  test("inverted ranking scores lower than perfect", () => {
    const relevance = new Map([
      ["a", 1],
      ["b", 1],
    ]);
    const perfect = ndcgAtK(["a", "b", "c"], relevance, 3);
    const inverted = ndcgAtK(["c", "a", "b"], relevance, 3);
    expect(inverted).toBeLessThan(perfect);
  });

  test("no relevant items returns 0", () => {
    expect(ndcgAtK(["a", "b"], new Map(), 2)).toBe(0);
  });

  test("graded relevance affects score", () => {
    const graded = new Map([
      ["a", 2],
      ["b", 1],
    ]);
    const bestFirst = ndcgAtK(["a", "b"], graded, 2);
    const worstFirst = ndcgAtK(["b", "a"], graded, 2);
    expect(bestFirst).toBeGreaterThan(worstFirst);
  });
});

describe("computeQueryMetrics", () => {
  test("computes both metrics for all k values", () => {
    const result = computeQueryMetrics(["a", "b", "c", "d", "e"], ["a", "c"], [3, 5]);
    expect(result.recallAtK[3]).toBeCloseTo(1);
    expect(result.recallAtK[5]).toBeCloseTo(1);
    expect(result.ndcgAtK[3]).toBeGreaterThan(0);
    expect(result.ndcgAtK[5]).toBeGreaterThan(0);
  });
});

describe("aggregateMetrics", () => {
  test("averages across queries", () => {
    const queries = [
      { queryId: "q1", question: "?", retrievedIds: [], relevantIds: [], recallAtK: { 5: 1.0 }, ndcgAtK: { 5: 0.8 } },
      { queryId: "q2", question: "?", retrievedIds: [], relevantIds: [], recallAtK: { 5: 0.5 }, ndcgAtK: { 5: 0.6 } },
    ];
    const agg = aggregateMetrics(queries, [5]);
    expect(agg.recallAtK[5]).toBeCloseTo(0.75);
    expect(agg.ndcgAtK[5]).toBeCloseTo(0.7);
  });

  test("handles empty query list", () => {
    const agg = aggregateMetrics([], [5]);
    expect(agg.recallAtK[5]).toBe(0);
    expect(agg.ndcgAtK[5]).toBe(0);
  });
});
