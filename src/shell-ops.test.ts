import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { runShellCommand } from "./shell-ops";
import { testUuid } from "./test-utils";

const WORKSPACE = resolve(process.cwd());

describe("runShellCommand", () => {
  test("runs in-workspace commands", async () => {
    const output = await runShellCommand(WORKSPACE, "printf 'ok'");
    expect(output).toContain("exit_code=0");
    expect(output).toContain("ok");
  });

  test("blocks absolute paths outside workspace", async () => {
    await expect(runShellCommand(WORKSPACE, "echo hi > /etc/acolyte-outside.txt")).rejects.toThrow(
      "Command references path outside workspace and /tmp",
    );
  });

  test("allows /tmp paths", async () => {
    const filePath = `/tmp/acolyte-test-run-${testUuid()}.txt`;
    const output = await runShellCommand(WORKSPACE, `printf 'ok' > ${filePath}`);
    expect(output).toContain("exit_code=0");
  });

  test("blocks home paths", async () => {
    await expect(runShellCommand(WORKSPACE, "cat ~/Documents")).rejects.toThrow(
      "Command references home path outside allowed roots",
    );
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
    await expect(runShellCommand(WORKSPACE, "cat ../../etc/passwd")).rejects.toThrow("path traversal");
  });
});
