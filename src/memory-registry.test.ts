import { describe, test } from "bun:test";
import { createMemoryRegistry } from "./memory-registry";

describe("memory registry", () => {
  test("commit does not throw", async () => {
    const registry = createMemoryRegistry();
    await registry.commit({ messages: [], output: "done" });
  });
});
