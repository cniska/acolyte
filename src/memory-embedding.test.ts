import { describe, expect, test } from "bun:test";
import { bufferToEmbedding, computeIdf, cosineSimilarity, embeddingToBuffer, tokenOverlap } from "./memory-embedding";

describe("cosineSimilarity", () => {
  test("identical vectors return 1", () => {
    const a = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1);
  });

  test("orthogonal vectors return 0", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });

  test("opposite vectors return -1", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1);
  });

  test("similar vectors score higher than dissimilar", () => {
    const query = new Float32Array([1, 0, 0, 0]);
    const similar = new Float32Array([0.9, 0.1, 0, 0]);
    const dissimilar = new Float32Array([0, 1, 0, 0]);
    expect(cosineSimilarity(query, similar)).toBeGreaterThan(cosineSimilarity(query, dissimilar));
  });

  test("zero vectors return 0", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe("tokenOverlap", () => {
  test("exact query tokens in content scores 1", () => {
    expect(tokenOverlap("bun test runner", "the project uses bun test runner")).toBeCloseTo(1);
  });

  test("partial overlap scores proportionally", () => {
    expect(tokenOverlap("bun test runner", "bun is fast")).toBeCloseTo(1 / 3);
  });

  test("no overlap scores 0", () => {
    expect(tokenOverlap("bun test runner", "python flask server")).toBe(0);
  });

  test("filters stopwords", () => {
    expect(tokenOverlap("what is the test runner", "test runner is bun")).toBeCloseTo(1);
  });

  test("case insensitive", () => {
    expect(tokenOverlap("Bun Test", "uses bun test")).toBeCloseTo(1);
  });

  test("empty query returns 0", () => {
    expect(tokenOverlap("", "some content")).toBe(0);
  });

  test("stopwords-only query returns 0", () => {
    expect(tokenOverlap("the a is", "some content")).toBe(0);
  });

  test("idf-weighted overlap favors rare tokens", () => {
    const corpus = ["project uses bun", "project uses typescript", "project has tests", "pgvector is configured"];
    const idf = computeIdf(corpus);
    const common = tokenOverlap("project tools", "project uses bun", idf);
    const rare = tokenOverlap("pgvector tools", "pgvector is configured", idf);
    expect(rare).toBeGreaterThan(common);
  });
});

describe("computeIdf", () => {
  test("rare tokens get higher scores", () => {
    const idf = computeIdf(["bun test", "bun build", "pgvector setup"]);
    const bunScore = idf.get("bun") ?? 0;
    const pgvectorScore = idf.get("pgvector") ?? 0;
    expect(pgvectorScore).toBeGreaterThan(bunScore);
  });

  test("empty corpus returns empty map", () => {
    expect(computeIdf([]).size).toBe(0);
  });
});

describe("embedding serialization", () => {
  test("round-trips through buffer", () => {
    const original = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const buf = embeddingToBuffer(original);
    const restored = bufferToEmbedding(buf);
    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i]);
    }
  });
});
