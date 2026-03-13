import { describe, expect, test } from "bun:test";
import { BEHAVIOR_SCENARIO_LIST, parseBehaviorScenarioId } from "./behavior-scenarios";
import { parseArgs } from "./run-behavior";

describe("run-behavior args", () => {
  test("parseArgs applies defaults", () => {
    expect(parseArgs([])).toEqual({
      model: "anthropic/claude-sonnet-4-6",
      scenarioIds: BEHAVIOR_SCENARIO_LIST.map((scenario) => scenario.id),
      keepWorkspaces: false,
      json: false,
      timeoutMs: 180_000,
    });
  });

  test("parseArgs parses explicit flags", () => {
    expect(parseArgs(["--model", "gpt-5-mini", "--scenario", "docs-link-fix", "--keep-workspaces", "--json"])).toEqual(
      {
        model: "gpt-5-mini",
        scenarioIds: ["docs-link-fix"],
        keepWorkspaces: true,
        json: true,
        timeoutMs: 180_000,
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
