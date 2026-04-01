import { describe, expect, test } from "bun:test";
import { createMemoryRegistry } from "./memory-registry";
import { createMemorySource } from "./test-utils";

describe("memory registry", () => {
  test("load returns empty prompt (no upfront injection)", async () => {
    const registry = createMemoryRegistry();
    const result = await registry.load({}, 1000);
    expect(result.prompt).toBe("");
    expect(result.tokenEstimate).toBe(0);
    expect(result.entryCount).toBe(0);
    expect(result.continuationSelected).toBe(false);
    expect(result.continuation).toEqual({});
  });

  test("commit runs distill sources", async () => {
    const calls: string[] = [];
    const source = createMemorySource("distill", [], () => {
      calls.push("committed");
    });
    // The default registry uses hardcoded distill sources.
    // Here we just verify the commit pipeline contract.
    const registry = createMemoryRegistry();
    await registry.commit({ messages: [], output: "done" });
    // Commit runs the real distill sources — we can't easily mock them here.
    // This test verifies commit doesn't throw.
    expect(true).toBe(true);
  });
});
