import { describe, expect, test } from "bun:test";
import { commitMemorySources, createMemoryRegistry } from "./memory-registry";

describe("memory registry", () => {
  test("commit returns metrics", async () => {
    const registry = createMemoryRegistry();
    const metrics = await registry.commit({ messages: [], output: "done" });
    expect(metrics).toHaveProperty("projectPromotedFacts");
    expect(metrics).toHaveProperty("userPromotedFacts");
    expect(metrics).toHaveProperty("sessionScopedFacts");
    expect(metrics).toHaveProperty("droppedUntaggedFacts");
  });

  test("commitMemorySources delegates to default registry", async () => {
    const metrics = await commitMemorySources({ messages: [], output: "done" });
    expect(typeof metrics.sessionScopedFacts).toBe("number");
  });
});
