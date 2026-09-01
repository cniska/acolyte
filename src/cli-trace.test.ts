import { describe, expect, test } from "bun:test";
import { matchesTraceFilter } from "./cli-trace";
import type { LogLine } from "./log-parser";

function line(fields: Record<string, string>): LogLine {
  return {
    raw: "",
    timestamp: "2026-01-01T00:00:00.000Z",
    fields,
    taskId: "task_1",
    requestId: undefined,
  };
}

function event(name: string, tool?: string): LogLine {
  return line(tool ? { event: name, tool } : { event: name });
}

describe("matchesTraceFilter", () => {
  test("an empty filter keeps every line", () => {
    const filter = { events: [], tool: undefined };
    expect(matchesTraceFilter(event("lifecycle.start"), filter)).toBe(true);
    expect(matchesTraceFilter(event("lifecycle.tool.call", "file-read"), filter)).toBe(true);
  });

  test("event filter keeps only the named events", () => {
    const filter = { events: ["lifecycle.model_usage", "lifecycle.error"], tool: undefined };
    expect(matchesTraceFilter(event("lifecycle.model_usage"), filter)).toBe(true);
    expect(matchesTraceFilter(event("lifecycle.error"), filter)).toBe(true);
    expect(matchesTraceFilter(event("lifecycle.tool.call"), filter)).toBe(false);
  });

  test("tool filter spans every event carrying that tool", () => {
    const filter = { events: [], tool: "shell-exec" };
    expect(matchesTraceFilter(event("lifecycle.tool.call", "shell-exec"), filter)).toBe(true);
    expect(matchesTraceFilter(event("lifecycle.tool.result", "shell-exec"), filter)).toBe(true);
    expect(matchesTraceFilter(event("lifecycle.tool.call", "file-read"), filter)).toBe(false);
    expect(matchesTraceFilter(event("lifecycle.start"), filter)).toBe(false);
  });

  test("event and tool compose", () => {
    const filter = { events: ["lifecycle.tool.result"], tool: "shell-exec" };
    expect(matchesTraceFilter(event("lifecycle.tool.result", "shell-exec"), filter)).toBe(true);
    expect(matchesTraceFilter(event("lifecycle.tool.call", "shell-exec"), filter)).toBe(false);
    expect(matchesTraceFilter(event("lifecycle.tool.result", "file-read"), filter)).toBe(false);
  });

  test("a line with no event is dropped by an event filter", () => {
    const filter = { events: ["lifecycle.start"], tool: undefined };
    expect(matchesTraceFilter(line({}), filter)).toBe(false);
  });
});
