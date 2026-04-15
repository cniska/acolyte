import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "./error-contract";
import { tempDir } from "./test-utils";
import { toolsForAgent } from "./tool-registry";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

describe("shell-run through registry dispatch", () => {
  test("runs in-workspace commands", async () => {
    const workspace = dirs.createDir("acolyte-shell-run-");
    const { tools, session } = toolsForAgent({ workspace });
    const result = await tools.runCommand.execute({ cmd: "printf", args: ["ok"] }, "call_1");
    expect(result.result.output).toContain("ok");
    expect(result.result.exitCode).toBe(0);
    expect(session.callLog[0]?.toolName).toBe("shell-run");
  });

  test("allows workspace paths", async () => {
    const workspace = dirs.createDir("acolyte-shell-ws-");
    const filePath = join(workspace, "test.txt");
    await writeFile(filePath, "ok\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.runCommand.execute({ cmd: "cat", args: [filePath] }, "call_2");
    expect(result.result.output).toContain("ok");
  });

  test("rejects with timeout error when command exceeds limit", async () => {
    const workspace = dirs.createDir("acolyte-shell-timeout-");
    const { tools } = toolsForAgent({ workspace });
    await expect(tools.runCommand.execute({ cmd: "sleep", args: ["5"], timeoutMs: 500 }, "call_3")).rejects.toThrow(
      /timed out/i,
    );
  });

  test("allows flag arguments containing slashes", async () => {
    const workspace = dirs.createDir("acolyte-shell-flags-");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.runCommand.execute({ cmd: "echo", args: ["--format=json/pretty"] }, "call_4");
    expect(result.result.output).toContain("--format=json/pretty");
  });

  test("does not evaluate shell operators", async () => {
    const workspace = dirs.createDir("acolyte-shell-ops-");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.runCommand.execute({ cmd: "echo", args: ["hello", "&&", "echo", "nope"] }, "call_5");
    expect(result.result.output).toContain("hello && echo nope");
  });

  test("blocks bare relative symlink escapes", async () => {
    const workspace = dirs.createDir("acolyte-shell-symlink-");
    const linkPath = join(workspace, "escape-link");
    await symlink("/etc/hosts", linkPath);
    const { tools } = toolsForAgent({ workspace });
    await expect(tools.runCommand.execute({ cmd: "cat", args: ["escape-link"] }, "call_6")).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
    });
  });

  test("allows nested relative paths within workspace", async () => {
    const workspace = dirs.createDir("acolyte-shell-nested-");
    const nestedDir = join(workspace, "nested");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(nestedDir, "note.txt"), "nested-ok\n", "utf8");

    const { tools } = toolsForAgent({ workspace });
    const result = await tools.runCommand.execute({ cmd: "cat", args: ["nested/note.txt"] }, "call_7");
    expect(result.result.output).toContain("nested-ok");
  });
});
