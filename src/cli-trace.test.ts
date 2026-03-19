import { describe, expect, test } from "bun:test";
import { compactLine, parseField, parseRequestId, parseTaskId, parseTimestamp, traceMode } from "./cli-trace";

type TraceDeps = Parameters<typeof traceMode>[1];

function createDeps(overrides?: Partial<TraceDeps>): { deps: TraceDeps; output: () => string } {
  const lines: string[] = [];
  const deps: TraceDeps = {
    hasHelpFlag: () => false,
    printDim: (message) => lines.push(message),
    printError: (message) => lines.push(`ERROR: ${message}`),
    commandError: () => {},
    commandHelp: () => {},
    ...overrides,
  };
  return { deps, output: () => lines.join("\n") };
}

describe("parseField", () => {
  test("extracts unquoted value", () => {
    expect(parseField("foo=bar baz=qux", "foo")).toBe("bar");
    expect(parseField("foo=bar baz=qux", "baz")).toBe("qux");
  });

  test("extracts quoted value", () => {
    expect(parseField('msg="hello world" level=info', "msg")).toBe("hello world");
  });

  test("returns undefined for missing key", () => {
    expect(parseField("foo=bar", "missing")).toBeUndefined();
  });
});

describe("parseTimestamp", () => {
  test("extracts timestamp before first space", () => {
    expect(parseTimestamp("2026-03-19T10:00:00Z level=info msg=hello")).toBe("2026-03-19T10:00:00Z");
  });

  test("returns whole line when no space", () => {
    expect(parseTimestamp("nospace")).toBe("nospace");
  });
});

describe("parseRequestId", () => {
  test("extracts request_id", () => {
    expect(parseRequestId("foo request_id=req_abc123 bar")).toBe("req_abc123");
  });

  test("returns undefined when missing", () => {
    expect(parseRequestId("no request id here")).toBeUndefined();
  });
});

describe("parseTaskId", () => {
  test("extracts task_id", () => {
    expect(parseTaskId("foo task_id=task_abc123 bar")).toBe("task_abc123");
  });

  test("returns undefined for null value", () => {
    expect(parseTaskId("task_id=null")).toBeUndefined();
  });

  test("returns undefined when missing", () => {
    expect(parseTaskId("no task id here")).toBeUndefined();
  });
});

describe("compactLine", () => {
  test("formats task state updated", () => {
    const line =
      '2026-03-19T10:00:00Z level=info msg="task state updated" task_id=task_1 from_state=pending to_state=running reason=scheduled transport=rpc';
    expect(compactLine(line)).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 state from=pending to=running reason=scheduled transport=rpc",
    );
  });

  test("formats lifecycle.start", () => {
    const line = "2026-03-19T10:00:00Z level=debug event=lifecycle.start task_id=task_1 mode=work model=gpt-5-mini";
    expect(compactLine(line)).toBe("2026-03-19T10:00:00Z task_id=task_1 lifecycle.start mode=work model=gpt-5-mini");
  });

  test("formats lifecycle.tool.call", () => {
    const line =
      "2026-03-19T10:00:00Z level=debug event=lifecycle.tool.call task_id=task_1 tool=read-file path=src/cli.ts";
    expect(compactLine(line)).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.tool.call tool=read-file path=src/cli.ts",
    );
  });

  test("formats lifecycle.generate.error", () => {
    const line =
      '2026-03-19T10:00:00Z level=debug event=lifecycle.generate.error task_id=task_1 model=gpt-5-mini error="timeout"';
    expect(compactLine(line)).toBe(
      '2026-03-19T10:00:00Z task_id=task_1 lifecycle.generate.error model=gpt-5-mini error="timeout"',
    );
  });

  test("formats lifecycle.error", () => {
    const line =
      '2026-03-19T10:00:00Z level=debug event=lifecycle.error task_id=task_1 source=generate kind=transient code=E_TIMEOUT category=timeout message="request timed out"';
    expect(compactLine(line)).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.error source=generate kind=transient code=E_TIMEOUT category=timeout",
    );
  });

  test("formats lifecycle.mode.changed", () => {
    const line =
      "2026-03-19T10:00:00Z level=debug event=lifecycle.mode.changed task_id=task_1 from=work to=verify trigger=evaluator";
    expect(compactLine(line)).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.mode.changed from=work to=verify trigger=evaluator",
    );
  });

  test("formats lifecycle.summary", () => {
    const line =
      "2026-03-19T10:00:00Z level=debug event=lifecycle.summary task_id=task_1 model_calls=3 total_tool_calls=5 read_calls=2 search_calls=1 write_calls=1 pre_write_discovery_calls=1 regeneration_count=0 guard_blocked_count=0 guard_flag_set_count=0 has_error=false";
    expect(compactLine(line)).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.summary model_calls=3 total_tool_calls=5 read=2 search=1 write=1 pre_write_discovery=1 regenerations=0 guard_blocked=0 guard_flag_set=0 has_error=false",
    );
  });

  test("formats lifecycle.memory events", () => {
    const line =
      "2026-03-19T10:00:00Z level=debug event=lifecycle.memory.load_skipped task_id=task_1 reason=request_disabled";
    expect(compactLine(line)).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.memory.load_skipped reason=request_disabled",
    );
  });

  test("formats lifecycle.skill.context", () => {
    const line =
      "2026-03-19T10:00:00Z level=debug event=lifecycle.skill.context task_id=task_1 skill_name=arch-audit instruction_chars=1500";
    expect(compactLine(line)).toBe(
      "2026-03-19T10:00:00Z task_id=task_1 lifecycle.skill.context skill_name=arch-audit instruction_chars=1500",
    );
  });

  test("formats unknown lifecycle event with just event name", () => {
    const line = "2026-03-19T10:00:00Z level=debug event=lifecycle.unknown.future task_id=task_1";
    expect(compactLine(line)).toBe("2026-03-19T10:00:00Z task_id=task_1 lifecycle.unknown.future");
  });

  test("formats line without event or msg", () => {
    const line = "2026-03-19T10:00:00Z level=info task_id=task_1";
    expect(compactLine(line)).toBe("2026-03-19T10:00:00Z task_id=task_1 log");
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
    await traceMode(["bogus", "--log", "/dev/null"], deps);
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
    await traceMode(["task", "--log", "/dev/null"], deps);
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
    await traceMode(["request", "--log", "/dev/null"], deps);
    expect(called).toBe(true);
  });

  test("missing log file prints error", async () => {
    const { deps, output } = createDeps();
    await traceMode(["--log", "/tmp/nonexistent-acolyte-test-log.log"], deps);
    expect(output()).toContain("Cannot read log file");
  });
});
