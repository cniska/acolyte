import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { ERROR_KINDS, TOOL_ERROR_CODES } from "./error-contract";
import { parseExitCode, runShellCommand } from "./shell-ops";
import { testUuid } from "./test-utils";

const WORKSPACE = resolve(process.cwd());

describe("runShellCommand", () => {
  test("runs in-workspace commands", async () => {
    const output = await runShellCommand(WORKSPACE, { cmd: "printf", args: ["ok"] });
    expect(output).toContain("exit_code=0");
    expect(output).toContain("ok");
  });

  test("blocks absolute paths outside workspace", async () => {
    await expect(runShellCommand(WORKSPACE, { cmd: "cat", args: ["/etc/hosts"] })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("allows workspace paths", async () => {
    const filePath = join(WORKSPACE, `acolyte-test-run-${testUuid()}.txt`);
    try {
      await writeFile(filePath, "ok\n", "utf8");
      const output = await runShellCommand(WORKSPACE, { cmd: "cat", args: [filePath] });
      expect(output).toContain("exit_code=0");
      expect(output).toContain("ok");
    } finally {
      await rm(filePath, { force: true });
    }
  });

  test("blocks home paths", async () => {
    await expect(runShellCommand(WORKSPACE, { cmd: "cat", args: ["~/Documents"] })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("includes timeout indicator when command exceeds timeout", async () => {
    const output = await runShellCommand(WORKSPACE, { cmd: "sleep", args: ["5"] }, 500);
    expect(output).toContain("TIMED OUT after 500ms");
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

  test("does not evaluate shell operators", async () => {
    const output = await runShellCommand(WORKSPACE, { cmd: "echo", args: ["hello", "&&", "echo", "nope"] });
    expect(output).toContain("exit_code=0");
    expect(output).toContain("hello && echo nope");
  });

  test("blocks command path outside workspace", async () => {
    await expect(runShellCommand(WORKSPACE, { cmd: "/bin/cat", args: ["README.md"] })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("blocks bare relative symlink escapes", async () => {
    const linkPath = join(WORKSPACE, `acolyte-test-link-${testUuid()}`);
    try {
      await symlink("/etc/hosts", linkPath);
      await expect(runShellCommand(WORKSPACE, { cmd: "cat", args: [basename(linkPath)] })).rejects.toMatchObject({
        code: TOOL_ERROR_CODES.sandboxViolation,
        kind: ERROR_KINDS.sandboxViolation,
      });
    } finally {
      await rm(linkPath, { force: true });
    }
  });

  test("allows nested relative paths within workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acolyte-shell-sandbox-"));
    const workspaceDir = join(dir, "workspace");
    const nestedDir = join(workspaceDir, "nested");
    const nestedFile = join(nestedDir, "note.txt");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(nestedFile, "nested-ok\n", "utf8");

    try {
      const output = await runShellCommand(workspaceDir, { cmd: "cat", args: ["nested/note.txt"] });
      expect(output).toContain("exit_code=0");
      expect(output).toContain("nested-ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
