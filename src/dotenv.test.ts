import { describe, expect, test } from "bun:test";
import { getDotenvValue, parseDotenv, removeDotenvKey, serializeDotenv, upsertDotenvValue } from "./dotenv";

describe("parseDotenv", () => {
  test("parses key=value pairs", () => {
    expect(parseDotenv("FOO=bar\nBAZ=qux\n")).toEqual([
      { key: "FOO", value: "bar" },
      { key: "BAZ", value: "qux" },
    ]);
  });

  test("skips comments and blank lines", () => {
    expect(parseDotenv("# comment\n\nFOO=bar\n")).toEqual([{ key: "FOO", value: "bar" }]);
  });

  test("skips lines without =", () => {
    expect(parseDotenv("no-equals\nFOO=bar\n")).toEqual([{ key: "FOO", value: "bar" }]);
  });

  test("handles empty content", () => {
    expect(parseDotenv("")).toEqual([]);
  });

  test("trims keys and values", () => {
    expect(parseDotenv("  FOO  =  bar  \n")).toEqual([{ key: "FOO", value: "bar" }]);
  });

  test("includes empty values", () => {
    expect(parseDotenv("FOO=\n")).toEqual([{ key: "FOO", value: "" }]);
  });
});

describe("serializeDotenv", () => {
  test("serializes entries", () => {
    expect(serializeDotenv([{ key: "FOO", value: "bar" }])).toBe("FOO=bar\n");
  });

  test("returns empty string for no entries", () => {
    expect(serializeDotenv([])).toBe("");
  });
});

describe("getDotenvValue", () => {
  test("finds value by key", () => {
    const entries = parseDotenv("FOO=bar\nBAZ=qux\n");
    expect(getDotenvValue(entries, "BAZ")).toBe("qux");
  });

  test("returns undefined for missing key", () => {
    expect(getDotenvValue([], "FOO")).toBeUndefined();
  });
});

describe("upsertDotenvValue", () => {
  test("appends new key", () => {
    expect(upsertDotenvValue("FOO=bar", "BAZ", "qux")).toBe("FOO=bar\nBAZ=qux\n");
  });

  test("replaces existing key", () => {
    expect(upsertDotenvValue("FOO=old\n", "FOO", "new")).toBe("FOO=new\n");
  });

  test("works with empty content", () => {
    expect(upsertDotenvValue("", "FOO", "bar")).toBe("FOO=bar\n");
  });
});

describe("removeDotenvKey", () => {
  test("removes key", () => {
    expect(removeDotenvKey("FOO=bar\nBAZ=qux\n", "FOO")).toBe("BAZ=qux\n");
  });

  test("returns empty when last key removed", () => {
    expect(removeDotenvKey("FOO=bar\n", "FOO")).toBe("");
  });

  test("no-op for missing key", () => {
    expect(removeDotenvKey("FOO=bar\n", "BAZ")).toBe("FOO=bar\n");
  });
});
