import { describe, expect, test } from "bun:test";
import {
  hasBoolFlag,
  hasHelpFlag,
  parseFlag,
  parseGlobalArgsAndCommand,
  parsePositional,
  parseRepeatableFlag,
  parseRequiredFlag,
  parseTailCount,
  stripFlag,
} from "./cli-args";

describe("hasHelpFlag", () => {
  test("matches --help", () => expect(hasHelpFlag(["--help"])).toBe(true));
  test("matches -h", () => expect(hasHelpFlag(["-h"])).toBe(true));
  test("matches help", () => expect(hasHelpFlag(["help"])).toBe(true));
  test("returns false for no flags", () => expect(hasHelpFlag(["run"])).toBe(false));
});

describe("parseFlag", () => {
  test("extracts value after flag", () => {
    expect(parseFlag(["--log", "/tmp/log"], "--log")).toBe("/tmp/log");
  });

  test("accepts alias array", () => {
    expect(parseFlag(["-n", "50"], ["--lines", "-n"])).toBe("50");
  });

  test("returns undefined when missing", () => {
    expect(parseFlag(["--other", "val"], "--log")).toBeUndefined();
  });

  test("returns undefined when flag has no value", () => {
    expect(parseFlag(["--log"], "--log")).toBeUndefined();
  });
});

describe("hasBoolFlag", () => {
  test("returns true when present", () => expect(hasBoolFlag(["--json"], "--json")).toBe(true));
  test("returns false when absent", () => expect(hasBoolFlag(["--log"], "--json")).toBe(false));
});

describe("parseRequiredFlag", () => {
  test("extracts value", () => {
    expect(parseRequiredFlag(["--model", "gpt-5"], "--model", "missing")).toBe("gpt-5");
  });

  test("returns undefined when flag absent", () => {
    expect(parseRequiredFlag(["--other"], "--model", "missing")).toBeUndefined();
  });

  test("throws when flag has no value", () => {
    expect(() => parseRequiredFlag(["--model"], "--model", "missing model")).toThrow("missing model");
  });
});

describe("parseRepeatableFlag", () => {
  test("collects multiple values", () => {
    expect(parseRepeatableFlag(["--file", "a.ts", "--file", "b.ts"], "--file", "missing")).toEqual(["a.ts", "b.ts"]);
  });

  test("returns empty when flag absent", () => {
    expect(parseRepeatableFlag(["--other"], "--file", "missing")).toEqual([]);
  });

  test("throws when flag has no value", () => {
    expect(() => parseRepeatableFlag(["--file"], "--file", "missing file")).toThrow("missing file");
  });
});

describe("parseTailCount", () => {
  test("returns default when undefined", () => expect(parseTailCount(undefined)).toBe(40));
  test("parses valid number", () => expect(parseTailCount("100")).toBe(100));
  test("allows zero", () => expect(parseTailCount("0")).toBe(0));
  test("returns default for non-numeric", () => expect(parseTailCount("abc")).toBe(40));
  test("accepts custom default", () => expect(parseTailCount(undefined, 20)).toBe(20));
});

describe("stripFlag", () => {
  test("removes matching flag", () => expect(stripFlag(["--json", "list"], "--json")).toEqual(["list"]));
  test("preserves args when flag absent", () => expect(stripFlag(["list"], "--json")).toEqual(["list"]));
});

describe("parsePositional", () => {
  test("strips flags with values and collects positional", () => {
    expect(parsePositional(["task", "task_abc", "--log", "/tmp/log", "--json"], ["--log"])).toEqual([
      "task",
      "task_abc",
    ]);
  });

  test("skips boolean flags", () => {
    expect(parsePositional(["--json", "task"], [])).toEqual(["task"]);
  });
});

describe("parseGlobalArgsAndCommand", () => {
  test("parses --update with no command", () => {
    expect(parseGlobalArgsAndCommand(["--update"])).toEqual({ command: undefined, args: [], update: "force" });
  });

  test("parses --no-update with no command", () => {
    expect(parseGlobalArgsAndCommand(["--no-update"])).toEqual({ command: undefined, args: [], update: "skip" });
  });

  test("strips global flags and preserves command and args", () => {
    expect(parseGlobalArgsAndCommand(["--update", "run", "--model", "gpt-5-mini", "hi"])).toEqual({
      command: "run",
      args: ["--model", "gpt-5-mini", "hi"],
      update: "force",
    });
  });

  test("skip overrides force when both are present", () => {
    expect(parseGlobalArgsAndCommand(["--update", "--no-update"])).toEqual({
      command: undefined,
      args: [],
      update: "skip",
    });
  });
});
