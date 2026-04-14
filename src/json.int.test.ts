import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readJson } from "./json";
import { tempDir } from "./test-utils";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

describe("readJson", () => {
  test("returns null when file does not exist", () => {
    const dir = dirs.createDir("json-missing-");
    expect(readJson(dir, "missing.json")).toBeNull();
  });

  test("parses valid JSON file", async () => {
    const dir = dirs.createDir("json-valid-");
    await writeFile(join(dir, "data.json"), JSON.stringify({ foo: "bar", n: 42 }), "utf8");
    expect(readJson(dir, "data.json")).toEqual({ foo: "bar", n: 42 });
  });

  test("returns null for invalid JSON", async () => {
    const dir = dirs.createDir("json-invalid-");
    await writeFile(join(dir, "bad.json"), "not json {{{", "utf8");
    expect(readJson(dir, "bad.json")).toBeNull();
  });

  test("strips line comments for files ending in 'c' (e.g. .prettierrc)", async () => {
    const dir = dirs.createDir("json-comments-");
    await writeFile(join(dir, ".prettierrc"), '{ "key": "value" // comment\n}', "utf8");
    expect(readJson(dir, ".prettierrc")).toEqual({ key: "value" });
  });

  test("does not strip comments for regular .json files", async () => {
    const dir = dirs.createDir("json-no-strip-");
    // A JSON file with a string containing '//' should be preserved
    await writeFile(join(dir, "data.json"), JSON.stringify({ url: "https://example.com" }), "utf8");
    expect(readJson(dir, "data.json")).toEqual({ url: "https://example.com" });
  });
});
