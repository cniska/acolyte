import { describe, expect, test } from "bun:test";
import { parseArgs } from "../scripts/wait-server";

describe("wait-server args", () => {
  test("parseArgs applies defaults", () => {
    expect(parseArgs([])).toEqual({
      url: "http://localhost:6767/v1/status",
      timeoutMs: 10_000,
    });
  });

  test("parseArgs reads explicit flags", () => {
    expect(parseArgs(["--url", "http://127.0.0.1:1234/v1/status", "--timeout-ms", "1500"])).toEqual({
      url: "http://127.0.0.1:1234/v1/status",
      timeoutMs: 1500,
    });
  });

  test("parseArgs rejects invalid timeout value", () => {
    expect(() => parseArgs(["--timeout-ms", "0"])).toThrow("--timeout-ms must be a positive integer");
  });

  test("parseArgs rejects missing timeout value", () => {
    expect(() => parseArgs(["--timeout-ms"])).toThrow("--timeout-ms requires a value");
  });

  test("parseArgs rejects unknown flags", () => {
    expect(() => parseArgs(["--wat"])).toThrow("Unknown argument: --wat");
  });
});
