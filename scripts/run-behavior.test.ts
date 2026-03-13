import { describe, expect, test } from "bun:test";
import { BEHAVIOR_SCENARIO_LIST, parseBehaviorScenarioId } from "./behavior-scenarios";
import { analyzeBehavior, parseArgs } from "./run-behavior";

describe("run-behavior args", () => {
  test("parseArgs applies defaults", () => {
    expect(parseArgs([])).toEqual({
      model: "anthropic/claude-sonnet-4-6",
      scenarioIds: BEHAVIOR_SCENARIO_LIST.map((scenario) => scenario.id),
      keepWorkspaces: false,
      json: false,
      timeoutMs: 60_000,
    });
  });

  test("parseArgs parses explicit flags", () => {
    expect(parseArgs(["--model", "gpt-5-mini", "--scenario", "docs-link-fix", "--keep-workspaces", "--json"])).toEqual(
      {
        model: "gpt-5-mini",
        scenarioIds: ["docs-link-fix"],
        keepWorkspaces: true,
        json: true,
        timeoutMs: 60_000,
      },
    );
  });

  test("parseArgs rejects unknown flags", () => {
    expect(() => parseArgs(["--bogus"])).toThrow("Unknown argument: --bogus");
  });
});

describe("behavior scenarios", () => {
  test("parseBehaviorScenarioId accepts known ids", () => {
    for (const scenario of BEHAVIOR_SCENARIO_LIST) expect(parseBehaviorScenarioId(scenario.id)).toBe(scenario.id);
  });

  test("parseBehaviorScenarioId rejects unknown ids", () => {
    expect(() => parseBehaviorScenarioId("wrong")).toThrow();
  });
});

describe("behavior analysis", () => {
  test("analyzeBehavior scores a clean bounded run highly", () => {
    const analysis = analyzeBehavior({
      exitCode: 0,
      expectedChangeCount: 2,
      trace: {
        taskId: "task_123",
        modelCalls: 3,
        totalToolCalls: 4,
        readCalls: 2,
        searchCalls: 1,
        writeCalls: 2,
        preWriteDiscoveryCalls: 2,
        regenerationCount: 0,
        guardBlockedCount: 0,
        hasError: false,
      },
    });

    expect(analysis.score).toBe(1);
    expect(analysis.verdict).toBe("strong");
  });

  test("analyzeBehavior penalizes spiraling runs", () => {
    const analysis = analyzeBehavior({
      exitCode: 1,
      expectedChangeCount: 1,
      trace: {
        taskId: "task_123",
        modelCalls: 40,
        totalToolCalls: 25,
        readCalls: 10,
        searchCalls: 6,
        writeCalls: 4,
        preWriteDiscoveryCalls: 8,
        regenerationCount: 2,
        guardBlockedCount: 4,
        hasError: true,
      },
    });

    expect(analysis.score).toBeLessThan(0.6);
    expect(analysis.verdict).toBe("weak");
  });

  test("analyzeBehavior treats timeout without trace detail as mixed instead of perfect", () => {
    const analysis = analyzeBehavior({
      exitCode: 124,
      expectedChangeCount: 2,
      trace: { taskId: "task_123" },
    });

    expect(analysis.score).toBe(0.7);
    expect(analysis.verdict).toBe("mixed");
  });
});
