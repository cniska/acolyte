import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { ERROR_KINDS, TOOL_ERROR_CODES } from "./error-contract";
import { parseExitCode, runShellCommand } from "./shell-ops";

const WORKSPACE = resolve(process.cwd());

describe("runShellCommand", () => {
  test("blocks absolute paths outside workspace", async () => {
    await expect(runShellCommand(WORKSPACE, { cmd: "cat", args: ["/etc/hosts"] })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("blocks home paths", async () => {
    await expect(runShellCommand(WORKSPACE, { cmd: "cat", args: ["~/Documents"] })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("rejects empty command", async () => {
    await expect(runShellCommand(WORKSPACE, { cmd: "" })).rejects.toThrow("Command cannot be empty");
  });

  test("blocks blocked executables", async () => {
    await expect(runShellCommand(WORKSPACE, { cmd: "shutdown", args: ["now"] })).rejects.toThrow("blocked executable");
  });

  test("blocks path traversal", async () => {
    await expect(runShellCommand(WORKSPACE, { cmd: "cat", args: ["../../etc/passwd"] })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("blocks command path outside workspace", async () => {
    await expect(runShellCommand(WORKSPACE, { cmd: "/bin/cat", args: ["README.md"] })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("blocks tilde command path", async () => {
    await expect(runShellCommand(WORKSPACE, { cmd: "~/bin/evil" })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("blocks tilde in assigned value", async () => {
    await expect(runShellCommand(WORKSPACE, { cmd: "env", args: ["OUT=~/secret"] })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("blocks path-like assigned values in arguments", async () => {
    await expect(runShellCommand(WORKSPACE, { cmd: "env", args: ["OUT=/etc/passwd"] })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });
});

describe("parseExitCode", () => {
  test("parses valid exit codes", () => {
    expect(parseExitCode("exit_code=0\nduration_ms=20")).toBe(0);
    expect(parseExitCode("exit_code=17\nstdout:\nnope")).toBe(17);
    expect(parseExitCode("exit_code=127")).toBe(127);
  });

  test("returns undefined for missing exit code", () => {
    expect(parseExitCode("stdout:\nmissing")).toBeUndefined();
    expect(parseExitCode("")).toBeUndefined();
  });

  test("returns undefined for malformed exit code", () => {
    expect(parseExitCode("exit_code=abc")).toBeUndefined();
  });
});
