import { afterAll, describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { editFileReplace, readSnippet, runShellCommand } from "./coding-tools";

const tempFiles: string[] = [];

afterAll(async () => {
  await Promise.all(tempFiles.map(async (filePath) => await rm(filePath, { force: true })));
});

describe("coding-tools workspace guards", () => {
  test("readSnippet blocks paths outside workspace", async () => {
    await expect(readSnippet("/tmp/acolyte-outside.txt")).rejects.toThrow(
      "Read is restricted to the current workspace",
    );
  });

  test("editFileReplace blocks paths outside workspace", async () => {
    await expect(
      editFileReplace({
        path: "/tmp/acolyte-outside-edit.txt",
        find: "a",
        replace: "b",
      }),
    ).rejects.toThrow("Edit is restricted to the current workspace");
  });

  test("runShellCommand blocks absolute paths outside workspace", async () => {
    await expect(runShellCommand("echo hi > /tmp/acolyte-outside.txt")).rejects.toThrow(
      "Command references absolute path outside workspace",
    );
  });

  test("runShellCommand allows in-workspace commands", async () => {
    const output = await runShellCommand("printf 'ok'");
    expect(output).toContain("exit_code=0");
    expect(output).toContain("ok");
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
