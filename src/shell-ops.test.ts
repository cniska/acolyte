import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { ERROR_KINDS, TOOL_ERROR_CODES } from "./error-contract";
import { createControlSequenceScrubber, parseExitCode, runShellCommand } from "./shell-ops";

function scrubOnce(text: string): string {
  const scrubber = createControlSequenceScrubber();
  return scrubber.push(text) + scrubber.flush();
}

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

describe("createControlSequenceScrubber", () => {
  test("strips the bun screen-clear sequence", () => {
    expect(scrubOnce("\x1b[2J\x1b[3J\x1b[Hdone")).toBe("done");
  });

  test("strips SGR color", () => {
    expect(scrubOnce("\x1b[32m✓ pass\x1b[39m")).toBe("✓ pass");
  });

  test("strips OSC clipboard and title sequences", () => {
    expect(scrubOnce("\x1b]52;c;Zm9v\x07keep")).toBe("keep");
    expect(scrubOnce("\x1b]0;title\x1b\\keep")).toBe("keep");
  });

  test("drops lone control chars but keeps tab and newline", () => {
    expect(scrubOnce("a\x00b\x07c\td\ne")).toBe("abc\td\ne");
  });

  test("preserves unicode and plain text", () => {
    expect(scrubOnce("✓ 20 pass — café 日本語")).toBe("✓ 20 pass — café 日本語");
  });

  test("folds CRLF and lone CR to newlines", () => {
    expect(scrubOnce("a\r\nb")).toBe("a\nb");
    expect(scrubOnce("10%\r20%\r30%")).toBe("10%\n20%\n30%");
  });

  test("aborts a malformed CSI on a control byte instead of swallowing text", () => {
    expect(scrubOnce("\x1b[1\nkept")).toBe("\nkept");
  });

  test("aborts a malformed CSI on an out-of-range byte", () => {
    expect(scrubOnce("\x1b[1日done")).toBe("日done");
  });

  test("carries an OSC whose ST terminator is split across chunks", () => {
    const scrubber = createControlSequenceScrubber();
    expect(scrubber.push("\x1b]0;title\x1b")).toBe("");
    expect(scrubber.push("\\rest")).toBe("rest");
  });

  test("carries a CSI sequence split across chunks", () => {
    const scrubber = createControlSequenceScrubber();
    expect(scrubber.push("\x1b[")).toBe("");
    expect(scrubber.push("2Jhi")).toBe("hi");
  });

  test("carries an OSC sequence split across chunks", () => {
    const scrubber = createControlSequenceScrubber();
    expect(scrubber.push("\x1b]0;ti")).toBe("");
    expect(scrubber.push("tle\x07x")).toBe("x");
  });

  test("carries a trailing CR across chunks and folds a following LF", () => {
    const scrubber = createControlSequenceScrubber();
    expect(scrubber.push("x\r")).toBe("x");
    expect(scrubber.push("\ny")).toBe("\ny");
  });

  test("flushes a carried CR as newline and drops an incomplete escape", () => {
    const withCr = createControlSequenceScrubber();
    expect(withCr.push("x\r")).toBe("x");
    expect(withCr.flush()).toBe("\n");
    const withEsc = createControlSequenceScrubber();
    expect(withEsc.push("a\x1b[")).toBe("a");
    expect(withEsc.flush()).toBe("");
  });
});

describe("runShellCommand output scrubbing", () => {
  test("strips control sequences from captured stdout", async () => {
    const result = await runShellCommand(WORKSPACE, {
      cmd: "bun",
      args: ["-e", "process.stdout.write('\\u001b[2Jclean output')"],
    });
    expect(result).toContain("clean output");
    expect(result).not.toContain("[2J");
    expect(result).not.toContain("\x1b");
  });
});
