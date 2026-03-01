import { describe, expect, test } from "bun:test";
import { formatDebugLine, matchesDebugFlag, parseDebugFlags } from "./debug-flags";

describe("debug flags", () => {
  test("parses comma and space separated flags", () => {
    const parsed = parseDebugFlags("tool-stream, lifecycle trace");
    expect(parsed.has("tool-stream")).toBe(true);
    expect(parsed.has("lifecycle")).toBe(true);
    expect(parsed.has("trace")).toBe(true);
  });

  test("returns empty set for empty input", () => {
    expect(parseDebugFlags(undefined).size).toBe(0);
    expect(parseDebugFlags("").size).toBe(0);
  });

  test("supports wildcard matching", () => {
    const flags = parseDebugFlags("tool-*,rpc-*,status");
    expect(matchesDebugFlag(flags, "tool-stream")).toBe(true);
    expect(matchesDebugFlag(flags, "tool-output")).toBe(true);
    expect(matchesDebugFlag(flags, "rpc-queue")).toBe(true);
    expect(matchesDebugFlag(flags, "status")).toBe(true);
    expect(matchesDebugFlag(flags, "lifecycle")).toBe(false);
  });

  test("formats debug lines with stable key=value fields", () => {
    expect(formatDebugLine("tool-stream", { tool: "read-file", count: 2 })).toBe(
      "[debug:tool-stream] tool=read-file count=2",
    );
  });
});
