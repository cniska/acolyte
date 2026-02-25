import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appConfig, setPermissionMode } from "./app-config";
import { editFileReplace, fetchWeb, readSnippet, runShellCommand, writeTextFile } from "./coding-tools";

const tempFiles: string[] = [];
const initialPermissionMode = appConfig.agent.permissions.mode;

afterAll(async () => {
  await Promise.all(tempFiles.map(async (filePath) => await rm(filePath, { force: true })));
  setPermissionMode(initialPermissionMode);
});

describe("coding-tools workspace guards", () => {
  beforeEach(() => {
    setPermissionMode("write");
  });

  afterEach(() => {
    setPermissionMode(initialPermissionMode);
  });

  test("readSnippet blocks paths outside workspace", async () => {
    await expect(readSnippet("/etc/hosts")).rejects.toThrow("Read is restricted to the workspace or /tmp");
  });

  test("editFileReplace blocks paths outside workspace", async () => {
    await expect(
      editFileReplace({
        path: "/etc/hosts",
        find: "a",
        replace: "b",
      }),
    ).rejects.toThrow("Edit is restricted to the workspace or /tmp");
  });

  test("runShellCommand blocks absolute paths outside workspace", async () => {
    await expect(runShellCommand("echo hi > /etc/acolyte-outside.txt")).rejects.toThrow(
      "Command references path outside workspace and /tmp",
    );
  });

  test("readSnippet allows /tmp files", async () => {
    const filePath = `/tmp/acolyte-tmp-read-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "hello from tmp", "utf8");
    const output = await readSnippet(filePath, "1", "1");
    expect(output).toContain("hello from tmp");
  });

  test("editFileReplace allows /tmp files", async () => {
    const filePath = `/tmp/acolyte-tmp-edit-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha beta", "utf8");
    const output = await editFileReplace({
      path: filePath,
      find: "beta",
      replace: "gamma",
    });
    expect(output).toContain("matches=1");
  });

  test("runShellCommand allows /tmp paths", async () => {
    const filePath = `/tmp/acolyte-tmp-run-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    const output = await runShellCommand(`printf 'ok' > ${filePath}`);
    expect(output).toContain("exit_code=0");
  });

  test("runShellCommand allows in-workspace commands", async () => {
    const output = await runShellCommand("printf 'ok'");
    expect(output).toContain("exit_code=0");
    expect(output).toContain("ok");
  });

  test("runShellCommand blocks home paths", async () => {
    await expect(runShellCommand("cat ~/Documents")).rejects.toThrow(
      "Command references home path outside allowed roots",
    );
  });

  test("fetchWeb rejects invalid URL input", async () => {
    await expect(fetchWeb("not-a-url")).rejects.toThrow("Web fetch URL is invalid");
  });

  test("fetchWeb blocks localhost/private hosts", async () => {
    await expect(fetchWeb("http://localhost:6767/healthz")).rejects.toThrow("Web fetch blocks localhost/private hosts");
  });

  test("read mode blocks write tools", async () => {
    const prev = appConfig.agent.permissions.mode;
    setPermissionMode("read");
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
      setPermissionMode(prev);
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

  test("writeTextFile allows creating /tmp files", async () => {
    const filePath = `/tmp/acolyte-tmp-write-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    const result = await writeTextFile({
      path: filePath,
      content: "hello",
    });
    expect(result).toContain("bytes=5");
  });

  test("writeTextFile blocks paths outside workspace", async () => {
    await expect(
      writeTextFile({
        path: "/etc/acolyte.txt",
        content: "x",
      }),
    ).rejects.toThrow("Write is restricted to the workspace or /tmp");
  });

  test("read mode blocks writeTextFile", async () => {
    const prev = appConfig.agent.permissions.mode;
    setPermissionMode("read");
    try {
      await expect(
        writeTextFile({
          path: join(process.cwd(), `tmp-read-block-${crypto.randomUUID()}.txt`),
          content: "x",
        }),
      ).rejects.toThrow("File writing is disabled in read mode");
    } finally {
      setPermissionMode(prev);
    }
  });
});
