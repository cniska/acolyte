import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { TOOL_ERROR_CODES } from "./error-contract";
import { runShellCommand } from "./shell-ops";
import { tempDir, testUuid } from "./test-utils";

const WORKSPACE = resolve(process.cwd());
const dirs = tempDir();

afterEach(dirs.cleanupDirs);

describe("runShellCommand", () => {
  test("runs in-workspace commands", async () => {
    const output = await runShellCommand(WORKSPACE, { cmd: "printf", args: ["ok"] });
    expect(output).toContain("exit_code=0");
    expect(output).toContain("ok");
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

  test("includes timeout indicator when command exceeds timeout", async () => {
    const output = await runShellCommand(WORKSPACE, { cmd: "sleep", args: ["5"] }, 500);
    expect(output).toContain("TIMED OUT after 500ms");
  });

  test("allows flag arguments containing slashes", async () => {
    const output = await runShellCommand(WORKSPACE, { cmd: "echo", args: ["--format=json/pretty"] });
    expect(output).toContain("exit_code=0");
    expect(output).toContain("--format=json/pretty");
  });

  test("does not evaluate shell operators", async () => {
    const output = await runShellCommand(WORKSPACE, { cmd: "echo", args: ["hello", "&&", "echo", "nope"] });
    expect(output).toContain("exit_code=0");
    expect(output).toContain("hello && echo nope");
  });

  test("blocks bare relative symlink escapes", async () => {
    const linkPath = join(WORKSPACE, `acolyte-test-link-${testUuid()}`);
    try {
      await symlink("/etc/hosts", linkPath);
      await expect(runShellCommand(WORKSPACE, { cmd: "cat", args: [basename(linkPath)] })).rejects.toMatchObject({
        code: TOOL_ERROR_CODES.sandboxViolation,
      });
    } finally {
      await rm(linkPath, { force: true });
    }
  });

  test("allows nested relative paths within workspace", async () => {
    const dir = dirs.createDir("acolyte-shell-sandbox-");
    const workspaceDir = join(dir, "workspace");
    const nestedDir = join(workspaceDir, "nested");
    const nestedFile = join(nestedDir, "note.txt");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(nestedFile, "nested-ok\n", "utf8");

    const output = await runShellCommand(workspaceDir, { cmd: "cat", args: ["nested/note.txt"] });
    expect(output).toContain("exit_code=0");
    expect(output).toContain("nested-ok");
  });
});
