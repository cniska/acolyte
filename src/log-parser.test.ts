import { describe, expect, test } from "bun:test";
import { field, findLastErrRequestId, findLastTaskId, matchesRequestId, matchesTaskId, parseLog } from "./log-parser";

describe("parseLog", () => {
  test("parses timestamp from first token", () => {
    const [entry] = parseLog("2026-03-19T10:00:00Z level=info");
    expect(entry.timestamp).toBe("2026-03-19T10:00:00Z");
  });

  test("parses all key=value fields", () => {
    const [entry] = parseLog(
      "2026-03-19T10:00:00Z level=debug event=lifecycle.start task_id=task_1 mode=work model=gpt-5-mini",
    );
    expect(field(entry, "level")).toBe("debug");
    expect(field(entry, "event")).toBe("lifecycle.start");
    expect(field(entry, "mode")).toBe("work");
    expect(field(entry, "model")).toBe("gpt-5-mini");
  });

  test("parses quoted values", () => {
    const [entry] = parseLog('2026-03-19T10:00:00Z msg="hello world" tool=read-file');
    expect(field(entry, "msg")).toBe("hello world");
    expect(field(entry, "tool")).toBe("read-file");
  });

  test("extracts taskId from task_id field", () => {
    const [entry] = parseLog("2026-03-19T10:00:00Z task_id=task_abc123");
    expect(entry.taskId).toBe("task_abc123");
  });

  test("returns undefined taskId for null value", () => {
    const [entry] = parseLog("2026-03-19T10:00:00Z task_id=null");
    expect(entry.taskId).toBeUndefined();
  });

  test("extracts requestId from request_id field", () => {
    const [entry] = parseLog("2026-03-19T10:00:00Z request_id=req_abc123");
    expect(entry.requestId).toBe("req_abc123");
  });

  test("filters empty lines", () => {
    const entries = parseLog("line1 level=info\n\n  \nline2 level=debug");
    expect(entries.length).toBe(2);
  });

  test("returns undefined for missing field", () => {
    const [entry] = parseLog("2026-03-19T10:00:00Z level=info");
    expect(field(entry, "missing")).toBeUndefined();
  });
});

describe("matchesTaskId", () => {
  test("matches exact task_id", () => {
    const [entry] = parseLog("2026-03-19T10:00:00Z task_id=task_1");
    expect(matchesTaskId(entry, "task_1")).toBe(true);
  });

  test("does not match prefix", () => {
    const [entry] = parseLog("2026-03-19T10:00:00Z task_id=task_12");
    expect(matchesTaskId(entry, "task_1")).toBe(false);
  });

  test("does not match when no task_id", () => {
    const [entry] = parseLog("2026-03-19T10:00:00Z level=info");
    expect(matchesTaskId(entry, "task_1")).toBe(false);
  });
});

describe("matchesRequestId", () => {
  test("matches exact request_id", () => {
    const [entry] = parseLog("2026-03-19T10:00:00Z request_id=req_abc");
    expect(matchesRequestId(entry, "req_abc")).toBe(true);
  });

  test("does not match prefix", () => {
    const [entry] = parseLog("2026-03-19T10:00:00Z request_id=req_abc123");
    expect(matchesRequestId(entry, "req_abc")).toBe(false);
  });
});

describe("findLastTaskId", () => {
  test("finds last task_id in lines", () => {
    const lines = parseLog(["2026-01-01T00:00:00Z task_id=task_a", "2026-01-01T00:00:01Z task_id=task_b"].join("\n"));
    expect(findLastTaskId(lines)).toBe("task_b");
  });

  test("returns undefined when no task_id", () => {
    const lines = parseLog("2026-01-01T00:00:00Z level=info");
    expect(findLastTaskId(lines)).toBeUndefined();
  });
});

describe("findLastErrRequestId", () => {
  test("finds last err_ request_id", () => {
    const lines = parseLog(
      [
        "2026-01-01T00:00:00Z request_id=req_ok",
        "2026-01-01T00:00:01Z request_id=err_fail",
        "2026-01-01T00:00:02Z request_id=req_ok2",
      ].join("\n"),
    );
    expect(findLastErrRequestId(lines)).toBe("err_fail");
  });

  test("returns undefined when no err_ request", () => {
    const lines = parseLog("2026-01-01T00:00:00Z request_id=req_ok");
    expect(findLastErrRequestId(lines)).toBeUndefined();
  });
});
