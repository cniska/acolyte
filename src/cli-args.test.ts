import { describe, expect, test } from "bun:test";
import {
  hasBoolFlag,
  hasHelpFlag,
  parseFlag,
  parsePositional,
  parseRepeatableFlag,
  parseRequiredFlag,
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
