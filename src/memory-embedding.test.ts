import { describe, expect, test } from "bun:test";
import { bufferToEmbedding, cosineSimilarity, embeddingToBuffer } from "./memory-embedding";

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
