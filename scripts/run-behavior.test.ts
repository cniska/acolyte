import { describe, expect, test } from "bun:test";
import { BEHAVIOR_SCENARIO_BY_ID, BEHAVIOR_SCENARIO_LIST, parseBehaviorScenarioId } from "./behavior-scenarios";
import { analyzeBehavior, parseArgs, summarizeTrace, summarizeTranscript } from "./run-behavior";

describe("run-behavior args", () => {
  test("parseArgs applies defaults", () => {
    expect(parseArgs([])).toEqual({
      model: "gpt-5.2",
      scenarioIds: BEHAVIOR_SCENARIO_LIST.map((scenario) => scenario.id),
      keepWorkspaces: false,
      json: false,
      timeoutMs: 60_000,
    });
  });

  test("parseArgs parses explicit flags", () => {
    expect(parseArgs(["--model", "gpt-5-mini", "--scenario", "docs-link-fix", "--keep-workspaces", "--json"])).toEqual({
      model: "gpt-5-mini",
      scenarioIds: ["docs-link-fix"],
      keepWorkspaces: true,
      json: true,
      timeoutMs: 60_000,
    });
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

  test("includes bounded-return-fix, post-success-stop, code-scan-yaml-recovery, file-search-no-match-recovery, two-file-deps-rename, scoped-code-edit-rename, scoped-code-edit-rename-shorthand, class-field-code-edit-rename, scoped-code-edit-rename-target, and structured-code-edit-replace scenarios", () => {
    expect(BEHAVIOR_SCENARIO_LIST.some((scenario) => scenario.id === "bounded-return-fix")).toBe(true);
    expect(BEHAVIOR_SCENARIO_LIST.some((scenario) => scenario.id === "post-success-stop")).toBe(true);
    expect(BEHAVIOR_SCENARIO_LIST.some((scenario) => scenario.id === "code-scan-yaml-recovery")).toBe(true);
    expect(BEHAVIOR_SCENARIO_LIST.some((scenario) => scenario.id === "file-search-no-match-recovery")).toBe(true);
    expect(BEHAVIOR_SCENARIO_LIST.some((scenario) => scenario.id === "two-file-deps-rename")).toBe(true);
    expect(BEHAVIOR_SCENARIO_LIST.some((scenario) => scenario.id === "scoped-code-edit-rename")).toBe(true);
    expect(BEHAVIOR_SCENARIO_LIST.some((scenario) => scenario.id === "scoped-code-edit-rename-shorthand")).toBe(true);
    expect(BEHAVIOR_SCENARIO_LIST.some((scenario) => scenario.id === "class-field-code-edit-rename")).toBe(true);
    expect(BEHAVIOR_SCENARIO_LIST.some((scenario) => scenario.id === "scoped-code-edit-rename-target")).toBe(true);
    expect(BEHAVIOR_SCENARIO_LIST.some((scenario) => scenario.id === "structured-code-edit-replace")).toBe(true);
  });

  test("two-file-deps-rename trace accepts a single batched initial file-read", () => {
    const issues =
      BEHAVIOR_SCENARIO_BY_ID["two-file-deps-rename"].validateTrace?.([
        'ts event=lifecycle.tool.call tool=file-read paths="[{\\"path\\":\\"src/cli-run.ts\\"},{\\"path\\":\\"src/cli-skill.ts\\"}]"',
        "ts event=lifecycle.tool.call tool=file-edit path=src/cli-run.ts",
        "ts event=lifecycle.tool.call tool=file-edit path=src/cli-skill.ts",
        "ts event=lifecycle.summary lifecycle_signal=done has_error=false",
      ]) ?? [];

    expect(issues).not.toContain(
      "initial direct reads should cover src/cli-run.ts and src/cli-skill.ts before editing",
    );
  });

  test("bounded-return-fix trace counts successful writes from edit previews, not total write attempts", () => {
    const issues =
      BEHAVIOR_SCENARIO_BY_ID["bounded-return-fix"].validateTrace?.([
        'ts event=lifecycle.tool.call tool=file-read paths="[{\\"path\\":\\"src/lifecycle-state.ts\\"}]"',
        "ts event=lifecycle.tool.call tool=file-edit path=src/lifecycle-state.ts",
        'ts event=lifecycle.tool.output tool=file-edit preview="Edit src/lifecycle-state.ts (+8 -8)"',
        "ts event=lifecycle.tool.call tool=file-edit path=src/lifecycle-state.ts",
        'ts event=lifecycle.tool.error tool=file-edit error="find block not found"',
        "ts event=lifecycle.summary write_calls=2 lifecycle_signal=done has_error=false",
      ]) ?? [];

    expect(issues).not.toContain("bounded single-file scenario should use exactly 1 successful write, saw 2");
  });
});

describe("behavior analysis", () => {
  test("summarizeTrace counts code tools in fallback trace mode", () => {
    const trace = summarizeTrace([
      "ts level=debug event=lifecycle.generate.start task_id=task_123",
      "ts level=debug event=lifecycle.tool.call task_id=task_123 tool=file-read path=src/code-ops.ts",
      "ts level=debug event=lifecycle.tool.call task_id=task_123 tool=code-scan path=src/code-ops.ts",
      "ts level=debug event=lifecycle.tool.call task_id=task_123 tool=code-edit path=src/code-ops.ts",
      "ts level=debug event=lifecycle.signal.accepted task_id=task_123 signal=done",
    ]);

    expect(trace).toBeDefined();
    expect(trace?.taskId).toBe("task_123");
    expect(trace?.readCalls).toBe(1);
    expect(trace?.searchCalls).toBe(1);
    expect(trace?.writeCalls).toBe(1);
    expect(trace?.lifecycleSignal).toBe("done");
  });

  test("summarizeTranscript counts assistant preamble, tool lines, and post-write chatter", () => {
    const transcript = summarizeTranscript(
      [
        "\u001b[2mStarted server on port 52930 (pid 9658)\u001b[22m",
        "❯ Update src/foo.ts",
        "• Checking src/foo.ts, then updating it.",
        "\u001b[2m• Read src/foo.ts\u001b[22m",
        "\u001b[2m• Edit src/foo.ts (+1 -1)\u001b[22m",
        "Updated src/foo.ts.",
        "\u001b[2m• Scan Code src/foo.ts\u001b[22m",
      ].join("\n"),
    );

    expect(transcript).toEqual({
      assistantMessages: 2,
      assistantMessagesBeforeFirstTool: 1,
      assistantMessagesAfterFirstWrite: 1,
      toolMessages: 3,
      firstWriteSeen: true,
    });
  });

  test("analyzeBehavior scores a clean bounded run highly", () => {
    const analysis = analyzeBehavior({
      exitCode: 0,
      expectedChangeCount: 2,
      trace: {
        taskId: "task_123",
        modelCalls: 3,
        totalToolCalls: 4,
        uniqueToolCount: 3,
        readCalls: 2,
        searchCalls: 1,
        writeCalls: 2,
        preWriteDiscoveryCalls: 2,
        regenerationCount: 0,
        regenerationLimitHit: false,
        guardBlockedCount: 0,
        guardFlagSetCount: 0,
        hasError: false,
        timeoutErrorCount: 0,
        fileNotFoundErrorCount: 0,
        guardBlockedErrorCount: 0,
        otherErrorCount: 0,
      },
    });

    expect(analysis.score).toBe(1);
    expect(analysis.verdict).toBe("strong");
    expect(analysis.correctnessIssues).toEqual([]);
  });

  test("analyzeBehavior penalizes spiraling runs", () => {
    const analysis = analyzeBehavior({
      exitCode: 1,
      expectedChangeCount: 1,
      trace: {
        taskId: "task_123",
        modelCalls: 40,
        totalToolCalls: 25,
        uniqueToolCount: 8,
        readCalls: 10,
        searchCalls: 6,
        writeCalls: 4,
        preWriteDiscoveryCalls: 8,
        regenerationCount: 2,
        regenerationLimitHit: true,
        guardBlockedCount: 4,
        guardFlagSetCount: 2,
        hasError: true,
        timeoutErrorCount: 1,
        fileNotFoundErrorCount: 1,
        guardBlockedErrorCount: 2,
        otherErrorCount: 1,
      },
    });

    expect(analysis.score).toBeLessThan(0.4);
    expect(analysis.verdict).toBe("weak");
    expect(analysis.correctnessIssues).toEqual([]);
  });

  test("analyzeBehavior treats timeout without trace detail as mixed instead of perfect", () => {
    const analysis = analyzeBehavior({
      exitCode: 124,
      expectedChangeCount: 2,
      trace: { taskId: "task_123" },
    });

    expect(analysis.score).toBe(0.7);
    expect(analysis.verdict).toBe("mixed");
    expect(analysis.correctnessIssues).toEqual([]);
  });

  test("analyzeBehavior penalizes incorrect final workspace state", () => {
    const analysis = analyzeBehavior({
      exitCode: 0,
      expectedChangeCount: 2,
      correctnessIssues: ["README.md should link to CONTRIBUTING.md"],
      trace: {
        taskId: "task_123",
        modelCalls: 3,
        totalToolCalls: 4,
        uniqueToolCount: 3,
        readCalls: 2,
        searchCalls: 1,
        writeCalls: 2,
        preWriteDiscoveryCalls: 2,
        regenerationCount: 0,
        regenerationLimitHit: false,
        guardBlockedCount: 0,
        guardFlagSetCount: 0,
        hasError: false,
        timeoutErrorCount: 0,
        fileNotFoundErrorCount: 0,
        guardBlockedErrorCount: 0,
        otherErrorCount: 0,
      },
    });

    expect(analysis.score).toBe(0.8);
    expect(analysis.verdict).toBe("mixed");
    expect(analysis.correctnessIssues).toEqual(["README.md should link to CONTRIBUTING.md"]);
  });
});
