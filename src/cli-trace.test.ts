import { describe, expect, test } from "bun:test";
import { compactLine, traceMode } from "./cli-trace";
import { type LogLine, parseLog } from "./log-parser";

type TraceDeps = Parameters<typeof traceMode>[1];

function createDeps(overrides?: Partial<TraceDeps>): { deps: TraceDeps; output: () => string } {
  const lines: string[] = [];
  const deps: TraceDeps = {
    hasHelpFlag: () => false,
    logPath: "/dev/null",
    printDim: (message) => lines.push(message),
    printError: (message) => lines.push(`ERROR: ${message}`),
    readFile: async () => "",
    commandError: () => {},
    commandHelp: () => {},
    ...overrides,
  };
  return { deps, output: () => lines.join("\n") };
}

function line(raw: string): LogLine {
  return parseLog(raw)[0];
}

describe("compactLine", () => {
  test("formats task.state_updated", () => {
    expect(
      compactLine(
        line(
          '2026-03-19T10:00:00Z level=info msg="task state updated" event=task.state_updated task_id=task_1 from_state=pending to_state=running reason=scheduled transport=rpc',
        ),
      ),
    ).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 task.state_updated from=pending to=running reason=scheduled transport=rpc",
    );
  });

  test("formats lifecycle.start", () => {
    expect(
      compactLine(
        line("2026-03-19T10:00:00Z level=debug event=lifecycle.start task_id=task_1 mode=work model=gpt-5-mini"),
      ),
    ).toBe("2026-03-19T10:00:00Z task_id=task_1 lifecycle.start mode=work model=gpt-5-mini");
  });

  test("formats lifecycle.tool.call", () => {
    expect(
      compactLine(
        line(
          "2026-03-19T10:00:00Z level=debug event=lifecycle.tool.call task_id=task_1 tool=read-file path=src/cli.ts",
        ),
      ),
    ).toBe("2026-03-19T10:00:00Z task_id=task_1 lifecycle.tool.call tool=read-file path=src/cli.ts");
  });

  test("formats lifecycle.generate.done with text_chars", () => {
    expect(
      compactLine(
        line(
          "2026-03-19T10:00:00Z level=debug event=lifecycle.generate.done task_id=task_1 model=gpt-5-mini tool_calls=2 text_chars=150",
        ),
      ),
    ).toBe("2026-03-19T10:00:00Z task_id=task_1 lifecycle.generate.done model=gpt-5-mini tool_calls=2 text_chars=150");
  });

  test("formats lifecycle.generate.error", () => {
    expect(
      compactLine(
        line(
          '2026-03-19T10:00:00Z level=debug event=lifecycle.generate.error task_id=task_1 model=gpt-5-mini error="timeout"',
        ),
      ),
    ).toBe('2026-03-19T10:00:00Z task_id=task_1 lifecycle.generate.error model=gpt-5-mini error="timeout"');
  });

  test("formats lifecycle.error", () => {
    expect(
      compactLine(
        line(
          '2026-03-19T10:00:00Z level=debug event=lifecycle.error task_id=task_1 source=generate kind=transient code=E_TIMEOUT category=timeout message="request timed out"',
        ),
      ),
    ).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.error source=generate kind=transient code=E_TIMEOUT category=timeout",
    );
  });

  test("formats lifecycle.mode.changed", () => {
    expect(
      compactLine(
        line(
          "2026-03-19T10:00:00Z level=debug event=lifecycle.mode.changed task_id=task_1 from=work to=verify trigger=evaluator",
        ),
      ),
    ).toBe("2026-03-19T10:00:00Z task_id=task_1 lifecycle.mode.changed from=work to=verify trigger=evaluator");
  });

  test("formats lifecycle.summary", () => {
    expect(
      compactLine(
        line(
          "2026-03-19T10:00:00Z level=debug event=lifecycle.summary task_id=task_1 model_calls=3 total_tool_calls=5 read_calls=2 search_calls=1 write_calls=1 pre_write_discovery_calls=1 regeneration_count=0 guard_blocked_count=0 guard_flag_set_count=0 has_error=false",
        ),
      ),
    ).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.summary model_calls=3 total_tool_calls=5 read=2 search=1 write=1 pre_write_discovery=1 regenerations=0 guard_blocked=0 guard_flag_set=0 has_error=false",
    );
  });

  test("formats lifecycle.memory events", () => {
    expect(
      compactLine(
        line(
          "2026-03-19T10:00:00Z level=debug event=lifecycle.memory.load_skipped task_id=task_1 reason=request_disabled",
        ),
      ),
    ).toBe("2026-03-19T10:00:00Z task_id=task_1 lifecycle.memory.load_skipped reason=request_disabled");
  });

  test("formats lifecycle.skill.context", () => {
    expect(
      compactLine(
        line(
          "2026-03-19T10:00:00Z level=debug event=lifecycle.skill.context task_id=task_1 skill_name=arch-audit instruction_chars=1500",
        ),
      ),
    ).toBe("2026-03-19T10:00:00Z task_id=task_1 lifecycle.skill.context skill_name=arch-audit instruction_chars=1500");
  });

  test("formats lifecycle.eval.decision", () => {
    expect(
      compactLine(
        line(
          "2026-03-19T10:00:00Z level=debug event=lifecycle.eval.decision task_id=task_1 evaluator=verify action=regenerate regeneration_count=1",
        ),
      ),
    ).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.eval.decision evaluator=verify action=regenerate regeneration_count=1",
    );
  });

  test("formats lifecycle.eval.lint without evaluator field", () => {
    expect(compactLine(line("2026-03-19T10:00:00Z level=debug event=lifecycle.eval.lint task_id=task_1 files=3"))).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.eval.lint files=3",
    );
  });

  test("formats lifecycle.eval.verify_failure", () => {
    expect(
      compactLine(
        line("2026-03-19T10:00:00Z level=debug event=lifecycle.eval.verify_failure task_id=task_1 text_chars=500"),
      ),
    ).toBe("2026-03-19T10:00:00Z task_id=task_1 lifecycle.eval.verify_failure text_chars=500");
  });

  test("formats lifecycle.eval.tool_recovery", () => {
    expect(
      compactLine(
        line(
          "2026-03-19T10:00:00Z level=debug event=lifecycle.eval.tool_recovery task_id=task_1 recovery_tool=edit-file recovery_kind=disambiguate-match",
        ),
      ),
    ).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.eval.tool_recovery recovery_tool=edit-file recovery_kind=disambiguate-match",
    );
  });

  test("formats lifecycle.eval.repeated_failure", () => {
    expect(
      compactLine(
        line(
          "2026-03-19T10:00:00Z level=debug event=lifecycle.eval.repeated_failure task_id=task_1 signature=abc count=3 code=E_TIMEOUT category=timeout",
        ),
      ),
    ).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.eval.repeated_failure signature=abc count=3 code=E_TIMEOUT category=timeout",
    );
  });

  test("formats unknown lifecycle event with just event name", () => {
    expect(compactLine(line("2026-03-19T10:00:00Z level=debug event=lifecycle.unknown.future task_id=task_1"))).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.unknown.future",
    );
  });

  test("formats line without event or msg", () => {
    expect(compactLine(line("2026-03-19T10:00:00Z level=info task_id=task_1"))).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 log",
    );
  });
});

describe("traceMode", () => {
  test("help flag calls commandHelp", async () => {
    let called = false;
    const { deps } = createDeps({
      hasHelpFlag: () => true,
      commandHelp: (name) => {
        expect(name).toBe("trace");
        called = true;
      },
    });
    await traceMode([], deps);
    expect(called).toBe(true);
  });

  test("unknown subcommand calls commandError", async () => {
    let errorMsg = "";
    const { deps } = createDeps({
      commandError: (_name, msg) => {
        errorMsg = msg ?? "";
      },
    });
    await traceMode(["bogus"], deps);
    expect(errorMsg).toContain("Unknown subcommand");
  });

  test("task subcommand without id calls commandError", async () => {
    let called = false;
    const { deps } = createDeps({
      commandError: (_name, msg) => {
        called = true;
        expect(msg).toContain("Missing task ID");
      },
    });
    await traceMode(["task"], deps);
    expect(called).toBe(true);
  });

  test("request subcommand without id calls commandError", async () => {
    let called = false;
    const { deps } = createDeps({
      commandError: (_name, msg) => {
        called = true;
        expect(msg).toContain("Missing request ID");
      },
    });
    await traceMode(["request"], deps);
    expect(called).toBe(true);
  });

  test("missing log file prints error", async () => {
    const { deps, output } = createDeps({
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });
    await traceMode([], deps);
    expect(output()).toContain("Cannot read log file");
  });

  test("task subcommand filters by exact id", async () => {
    const logContent = [
      "2026-03-19T10:00:00Z level=debug event=lifecycle.start task_id=task_1 mode=work model=m",
      "2026-03-19T10:00:01Z level=debug event=lifecycle.start task_id=task_12 mode=work model=m",
    ].join("\n");
    const { deps, output } = createDeps({
      readFile: async () => logContent,
    });
    await traceMode(["task", "task_1"], deps);
    expect(output()).toContain("task_id=task_1");
    expect(output()).not.toContain("task_id=task_12");
  });

  test("request subcommand filters lines", async () => {
    const logContent = [
      "2026-03-19T10:00:00Z level=debug request_id=req_abc task_id=task_1 msg=hello",
      "2026-03-19T10:00:01Z level=debug request_id=req_other task_id=task_2 msg=world",
    ].join("\n");
    const { deps, output } = createDeps({
      readFile: async () => logContent,
    });
    await traceMode(["request", "req_abc"], deps);
    expect(output()).toContain("request_id=req_abc");
    expect(output()).not.toContain("req_other");
  });

  test("--lines flag controls tail count", async () => {
    const logContent = Array.from({ length: 100 }, (_, i) => `line${i} level=info`).join("\n");
    const { deps, output } = createDeps({
      readFile: async () => logContent,
    });
    await traceMode(["--lines", "5"], deps);
    const lines = output().split("\n");
    expect(lines.length).toBe(6);
  });

  test("--json outputs JSON lines for task subcommand", async () => {
    const logContent = [
      "2026-03-19T10:00:00Z level=debug event=lifecycle.start task_id=task_1 mode=work model=gpt-5-mini",
      "2026-03-19T10:00:01Z level=debug event=lifecycle.tool.call task_id=task_1 tool=read-file path=src/cli.ts",
    ].join("\n");
    const { deps, output } = createDeps({
      readFile: async () => logContent,
    });
    await traceMode(["task", "task_1", "--json"], deps);
    const lines = output().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]) as Record<string, string>;
    expect(first.timestamp).toBe("2026-03-19T10:00:00Z");
    expect(first.event).toBe("lifecycle.start");
    expect(first.task_id).toBe("task_1");
    expect(first.mode).toBe("work");
  });

  test("--json omits header lines", async () => {
    const logContent = "2026-03-19T10:00:00Z level=debug event=lifecycle.start task_id=task_1 mode=work model=m";
    const { deps, output } = createDeps({
      readFile: async () => logContent,
    });
    await traceMode(["--json"], deps);
    const lines = output().split("\n");
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });
});
