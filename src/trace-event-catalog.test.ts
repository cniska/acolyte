import { describe, expect, test } from "bun:test";
import {
  isCatalogTraceEvent,
  parseTraceFields,
  traceEventDisplayFields,
  traceEventNameSchema,
} from "./trace-event-catalog";

describe("trace event catalog", () => {
  test("defines event names and display fields in one catalog", () => {
    expect(traceEventNameSchema.options).toContain("lifecycle.start");
    expect(isCatalogTraceEvent("lifecycle.start")).toBe(true);
    expect(traceEventDisplayFields("lifecycle.summary")).toContain("model_calls");
    expect(traceEventDisplayFields("lifecycle.completion.rejected")).toContain("action");
  });

  test("validates known event fields and preserves additional scalar fields", () => {
    const fields = parseTraceFields("lifecycle.start", {
      model: "gpt-5.4",
      task_id: "task_123",
    });

    expect(fields).toEqual({ model: "gpt-5.4", task_id: "task_123" });
  });

  test("rejects non-scalar field values before trace persistence", () => {
    expect(() =>
      parseTraceFields("lifecycle.start", {
        model: "gpt-5.4",
        invalid: { nested: true },
      } as never),
    ).toThrow();
  });
});
