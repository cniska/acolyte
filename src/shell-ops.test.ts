import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ERROR_KINDS, TOOL_ERROR_CODES } from "./error-contract";
import { parseExitCode, runShellCommand } from "./shell-ops";
import { testUuid } from "./test-utils";

const WORKSPACE = resolve(process.cwd());

describe("runShellCommand", () => {
  test("runs in-workspace commands", async () => {
    const output = await runShellCommand(WORKSPACE, "printf 'ok'");
    expect(output).toContain("exit_code=0");
    expect(output).toContain("ok");
  });

  test("blocks absolute paths outside workspace", async () => {
    await expect(runShellCommand(WORKSPACE, "echo hi > /etc/acolyte-outside.txt")).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("allows workspace paths", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-run-${testUuid()}.txt`);
    try {
      const output = await runShellCommand(WORKSPACE, `printf 'ok' > ${filePath}`);
      expect(output).toContain("exit_code=0");
    } finally {
      await rm(filePath, { force: true });
    }
  });

  test("blocks home paths", async () => {
    await expect(runShellCommand(WORKSPACE, "cat ~/Documents")).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("includes timeout indicator when command exceeds timeout", async () => {
    const output = await runShellCommand(WORKSPACE, "sleep 5", 500);
    expect(output).toContain("TIMED OUT after 500ms");
  });

  test("rejects empty command", async () => {
    await expect(runShellCommand(WORKSPACE, "")).rejects.toThrow("Command cannot be empty");
  });

  test("blocks destructive tokens", async () => {
    await expect(runShellCommand(WORKSPACE, "rm -rf /")).rejects.toThrow("blocked token");
  });

  test("blocks path traversal", async () => {
    await expect(runShellCommand(WORKSPACE, "cat ../../etc/passwd")).rejects.toMatchObject({
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
