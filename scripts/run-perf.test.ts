import { describe, expect, test } from "bun:test";
import { parseArgs, summarizeScenarioRuns } from "./run-perf";

describe("run-perf args", () => {
  test("parseArgs applies defaults", () => {
    expect(parseArgs([])).toEqual({
      runs: 3,
      warmup: true,
      failMedianMs: null,
    });
  });

  test("parseArgs parses explicit flags", () => {
    expect(parseArgs(["--runs", "5", "--no-warmup", "--fail-median-ms", "800"])).toEqual({
      runs: 5,
      warmup: false,
      failMedianMs: 800,
    });
  });

  test("parseArgs rejects unknown flags", () => {
    expect(() => parseArgs(["--transport", "rpc"])).toThrow("Unknown argument: --transport");
  });
});

describe("run-perf summarize", () => {
  test("summarizeScenarioRuns computes aggregate metrics", () => {
    const summary = summarizeScenarioRuns(
      {
        id: "quick-answer",
        description: "baseline",
        prompt: "ok",
      },
      [
        { scenarioId: "quick-answer", run: 1, durationMs: 1000, exitCode: 0, modelCalls: 1, error: null },
        { scenarioId: "quick-answer", run: 2, durationMs: 1200, exitCode: 0, modelCalls: 2, error: null },
        { scenarioId: "quick-answer", run: 3, durationMs: 2000, exitCode: 1, modelCalls: 3, error: "failed" },
      ],
    );

    expect(summary.scenarioId).toBe("quick-answer");
    expect(summary.samples).toBe(3);
    expect(summary.successRate).toBeCloseTo((2 / 3) * 100, 5);
    expect(summary.minMs).toBe(1000);
    expect(summary.medianMs).toBe(1200);
    expect(summary.p95Ms).toBe(2000);
    expect(summary.maxMs).toBe(2000);
    expect(summary.avgModelCalls).toBeCloseTo(2, 5);
  });
});
