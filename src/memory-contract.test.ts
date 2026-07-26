import { describe, expect, test } from "bun:test";
import { formatDisposition, memoryDispositionSchema } from "./memory-contract";

describe("formatDisposition", () => {
  test("names every successor of a superseded record", () => {
    expect(formatDisposition({ kind: "superseded", by: ["mem_one00001"] })).toBe("superseded by mem_one00001");
    expect(formatDisposition({ kind: "superseded", by: ["mem_one00001", "mem_two00001"] })).toBe(
      "superseded by mem_one00001, mem_two00001",
    );
  });

  test("names the reason for the dispositions that have no successor", () => {
    expect(formatDisposition({ kind: "capacity" })).toBe("capacity");
    expect(formatDisposition({ kind: "noise" })).toBe("noise");
  });
});

describe("memoryDispositionSchema", () => {
  test("requires at least one successor for a supersession", () => {
    expect(memoryDispositionSchema.safeParse({ kind: "superseded", by: [] }).success).toBe(false);
    expect(memoryDispositionSchema.safeParse({ kind: "superseded" }).success).toBe(false);
    expect(memoryDispositionSchema.safeParse({ kind: "superseded", by: ["mem_one00001"] }).success).toBe(true);
  });

  test("rejects successor ids that are not memory ids", () => {
    expect(memoryDispositionSchema.safeParse({ kind: "superseded", by: ["not-an-id"] }).success).toBe(false);
  });

  test("rejects an unknown disposition", () => {
    expect(memoryDispositionSchema.safeParse({ kind: "expired" }).success).toBe(false);
  });
});
