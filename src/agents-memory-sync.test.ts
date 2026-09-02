import { describe, expect, test } from "bun:test";
import { rulesReachableFromMemory } from "./agents-memory-sync";

describe("rulesReachableFromMemory", () => {
  test("a fresh sync and an unchanged one both leave the rules in memory", () => {
    expect(rulesReachableFromMemory({ kind: "synced" })).toBe(true);
    expect(rulesReachableFromMemory({ kind: "skipped", reason: "unchanged" })).toBe(true);
  });

  test("nothing is in memory when the workspace has no project scope or the write failed", () => {
    expect(rulesReachableFromMemory({ kind: "skipped", reason: "no_project_scope" })).toBe(false);
    expect(rulesReachableFromMemory({ kind: "skipped", reason: "write_failed" })).toBe(false);
    expect(rulesReachableFromMemory({ kind: "removed" })).toBe(false);
  });
});
