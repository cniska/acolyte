import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { appConfig } from "./app-config";
import { editFileReplace, readSnippet, runShellCommand } from "./coding-tools";

const tempFiles: string[] = [];

afterAll(async () => {
  await Promise.all(tempFiles.map(async (filePath) => await rm(filePath, { force: true })));
});

describe("coding-tools workspace guards", () => {
  test("readSnippet blocks paths outside workspace", async () => {
    await expect(readSnippet("/tmp/acolyte-outside.txt")).rejects.toThrow(
      "Read is restricted to the workspace or ~/.acolyte",
    );
  });

  test("editFileReplace blocks paths outside workspace", async () => {
    await expect(
      editFileReplace({
        path: "/tmp/acolyte-outside-edit.txt",
        find: "a",
        replace: "b",
      }),
    ).rejects.toThrow("Edit is restricted to the workspace or ~/.acolyte");
  });

  test("runShellCommand blocks absolute paths outside workspace", async () => {
    await expect(runShellCommand("echo hi > /tmp/acolyte-outside.txt")).rejects.toThrow(
      "Command references path outside workspace and ~/.acolyte",
    );
  });

  test("runShellCommand allows in-workspace commands", async () => {
    const output = await runShellCommand("printf 'ok'");
    expect(output).toContain("exit_code=0");
    expect(output).toContain("ok");
  });

  test("readSnippet allows ~/.acolyte files", async () => {
    const filePath = join(homedir(), ".acolyte", `tmp-coding-tools-read-${crypto.randomUUID()}.txt`);
    tempFiles.push(filePath);
    await mkdir(join(homedir(), ".acolyte"), { recursive: true });
    await writeFile(filePath, "hello from acolyte home", "utf8");
    const output = await readSnippet(filePath, "1", "1");
    expect(output).toContain("hello from acolyte home");
  });

  test("editFileReplace allows ~/.acolyte files", async () => {
    const filePath = join(homedir(), ".acolyte", `tmp-coding-tools-edit-${crypto.randomUUID()}.txt`);
    tempFiles.push(filePath);
    await mkdir(join(homedir(), ".acolyte"), { recursive: true });
    await writeFile(filePath, "alpha beta", "utf8");
    const output = await editFileReplace({
      path: filePath,
      find: "beta",
      replace: "gamma",
    });
    expect(output).toContain("matches=1");
  });

  test("runShellCommand blocks home paths outside ~/.acolyte", async () => {
    await expect(runShellCommand("cat ~/Documents")).rejects.toThrow("Command references home path outside ~/.acolyte");
  });

  test("read mode blocks write tools", async () => {
    const prev = appConfig.agent.permissions.mode;
    (appConfig.agent.permissions as { mode: "read" | "write" }).mode = "read";
    try {
      await expect(runShellCommand("printf 'ok'")).rejects.toThrow("Shell command execution is disabled in read mode");
      await expect(
        editFileReplace({
          path: join(process.cwd(), "README.md"),
          find: "Acolyte",
          replace: "Acolyte",
          dryRun: true,
        }),
      ).rejects.toThrow("File editing is disabled in read mode");
    } finally {
      (appConfig.agent.permissions as { mode: "read" | "write" }).mode = prev;
    }
  });

  test("editFileReplace allows in-workspace edits", async () => {
    const filePath = join(process.cwd(), `tmp-coding-tools-${crypto.randomUUID()}.txt`);
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha beta", "utf8");
    const result = await editFileReplace({
      path: filePath,
      find: "beta",
      replace: "gamma",
    });
    expect(result).toContain("matches=1");
  });
});
