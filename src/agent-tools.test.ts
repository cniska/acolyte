import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  deleteTextFile,
  editCode,
  editFile,
  fetchWeb,
  readSnippet,
  runShellCommand,
  scanCode,
  writeTextFile,
} from "./agent-tools";
import { appConfig, setPermissionMode } from "./app-config";

const tempFiles: string[] = [];
const tempDirs: string[] = [];
const initialPermissionMode = appConfig.agent.permissions.mode;

afterAll(async () => {
  await Promise.all(tempFiles.map(async (filePath) => await rm(filePath, { force: true })));
  await Promise.all(tempDirs.map(async (dirPath) => await rm(dirPath, { recursive: true, force: true })));
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

  test("editFile blocks paths outside workspace", async () => {
    await expect(
      editFile({
        path: "/etc/hosts",
        edits: [{ find: "a", replace: "b" }],
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

  test("editFile allows /tmp files", async () => {
    const filePath = `/tmp/acolyte-tmp-edit-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha beta", "utf8");
    const output = await editFile({
      path: filePath,
      edits: [{ find: "beta", replace: "gamma" }],
    });
    expect(output).toContain("edits=1");
  });

  test("editFile rejects multi-match find text", async () => {
    const filePath = `/tmp/acolyte-tmp-multi-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "foo bar foo baz foo", "utf8");
    await expect(editFile({ path: filePath, edits: [{ find: "foo", replace: "qux" }] })).rejects.toThrow(
      "matched 3 locations",
    );
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
        editFile({
          path: join(process.cwd(), "README.md"),
          edits: [{ find: "Acolyte", replace: "Acolyte" }],
          dryRun: true,
        }),
      ).rejects.toThrow("File editing is disabled in read mode");
    } finally {
      setPermissionMode(prev);
    }
  });

  test("editFile allows in-workspace edits", async () => {
    const filePath = join(process.cwd(), `tmp-coding-tools-${crypto.randomUUID()}.txt`);
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha beta", "utf8");
    const result = await editFile({
      path: filePath,
      edits: [{ find: "beta", replace: "gamma" }],
    });
    expect(result).toContain("edits=1");
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

  test("deleteTextFile deletes /tmp files", async () => {
    const filePath = `/tmp/acolyte-tmp-delete-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha\nbeta\n", "utf8");
    const result = await deleteTextFile({ path: filePath });
    expect(result).toContain("bytes=");
    await expect(readSnippet(filePath)).rejects.toThrow();
  });

  test("deleteTextFile blocks paths outside workspace", async () => {
    await expect(deleteTextFile({ path: "/etc/hosts" })).rejects.toThrow(
      "Delete is restricted to the workspace or /tmp",
    );
  });

  test("read mode blocks deleteTextFile", async () => {
    const prev = appConfig.agent.permissions.mode;
    setPermissionMode("read");
    try {
      await expect(deleteTextFile({ path: join(process.cwd(), "README.md") })).rejects.toThrow(
        "File deletion is disabled in read mode",
      );
    } finally {
      setPermissionMode(prev);
    }
  });
});

describe("editCode", () => {
  beforeEach(() => {
    setPermissionMode("write");
  });

  afterEach(() => {
    setPermissionMode(initialPermissionMode);
  });

  test("replaces pattern matches with metavariable capture", async () => {
    const filePath = `/tmp/acolyte-ast-edit-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    await writeFile(filePath, 'console.log("hello");\nconsole.log("world");\n', "utf8");
    const result = await editCode({
      path: filePath,
      edits: [{ pattern: "console.log($ARG)", replacement: "logger.debug($ARG)" }],
    });
    expect(result).toContain("matches=2");
    expect(result).toContain("+logger.debug");
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('logger.debug("hello")');
    expect(content).toContain('logger.debug("world")');
    expect(content).not.toContain("console.log");
  });

  test("dry run preserves file", async () => {
    const filePath = `/tmp/acolyte-ast-dry-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    await writeFile(filePath, 'console.log("keep");\n', "utf8");
    const result = await editCode({
      path: filePath,
      edits: [{ pattern: "console.log($ARG)", replacement: "logger.debug($ARG)" }],
      dryRun: true,
    });
    expect(result).toContain("dry_run=true");
    expect(result).toContain("matches=1");
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("console.log");
  });

  test("throws when no matches found", async () => {
    const filePath = `/tmp/acolyte-ast-nomatch-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    await writeFile(filePath, "const x = 1;\n", "utf8");
    await expect(
      editCode({
        path: filePath,
        edits: [{ pattern: "console.log($ARG)", replacement: "logger.debug($ARG)" }],
      }),
    ).rejects.toThrow("No AST matches found");
  });

  test("blocks paths outside workspace", async () => {
    await expect(
      editCode({
        path: "/etc/hosts",
        edits: [{ pattern: "console.log($ARG)", replacement: "logger.debug($ARG)" }],
      }),
    ).rejects.toThrow("AST edit is restricted to the workspace or /tmp");
  });

  test("read mode blocks editCode", async () => {
    setPermissionMode("read");
    await expect(
      editCode({
        path: join(process.cwd(), "src/agent.ts"),
        edits: [{ pattern: "console.log($ARG)", replacement: "logger.debug($ARG)" }],
      }),
    ).rejects.toThrow("AST editing is disabled in read mode");
  });

  test("replaces pattern matches in Python files", async () => {
    const filePath = `/tmp/acolyte-ast-py-${crypto.randomUUID()}.py`;
    tempFiles.push(filePath);
    await writeFile(filePath, 'print("hello")\nprint("world")\n', "utf8");
    const result = await editCode({
      path: filePath,
      edits: [{ pattern: "print($ARG)", replacement: "log($ARG)" }],
    });
    expect(result).toContain("matches=2");
    const content = await readFile(filePath, "utf8");
    expect(content).toContain('log("hello")');
    expect(content).not.toContain("print");
  });

  test("replaces pattern matches in Rust files", async () => {
    const filePath = `/tmp/acolyte-ast-rs-${crypto.randomUUID()}.rs`;
    tempFiles.push(filePath);
    await writeFile(filePath, 'println!("hello");\nprintln!("world");\n', "utf8");
    const result = await editCode({
      path: filePath,
      edits: [{ pattern: "println!($ARGS)", replacement: "eprintln!($ARGS)" }],
    });
    expect(result).toContain("matches=2");
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("eprintln!");
    expect(content).not.toMatch(/(?<!e)println!/);
  });

  test("replaces pattern matches in Go files", async () => {
    const filePath = `/tmp/acolyte-ast-go-${crypto.randomUUID()}.go`;
    tempFiles.push(filePath);
    await writeFile(filePath, 'package main\n\nfunc main() {\n\tprintln("hello")\n\tprintln("world")\n}\n', "utf8");
    const result = await editCode({
      path: filePath,
      edits: [{ pattern: "println($ARG)", replacement: "print($ARG)" }],
    });
    expect(result).toContain("matches=2");
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("print(");
    expect(content).not.toContain("println(");
  });
});

describe("scanCode", () => {
  test("finds matches in a single file with metavariable captures", async () => {
    const filePath = `/tmp/acolyte-scan-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    await writeFile(filePath, 'console.log("hello");\nconsole.log("world");\nconst x = 1;\n', "utf8");
    const result = await scanCode({ path: filePath, pattern: "console.log($ARG)" });
    expect(result).toContain("scanned=1");
    expect(result).toContain("matches=2");
    expect(result).toContain('$ARG="hello"');
    expect(result).toContain('$ARG="world"');
  });

  test("returns no matches when pattern is absent", async () => {
    const filePath = `/tmp/acolyte-scan-nomatch-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    await writeFile(filePath, "const x = 1;\n", "utf8");
    const result = await scanCode({ path: filePath, pattern: "console.log($ARG)" });
    expect(result).toContain("matches=0");
    expect(result).toContain("No matches.");
  });

  test("scans a directory recursively", async () => {
    const dir = `/tmp/acolyte-scan-dir-${crypto.randomUUID()}`;
    tempDirs.push(dir);
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "a.ts"), 'console.log("a");\n', "utf8");
    await writeFile(join(dir, "sub", "b.ts"), 'console.log("b");\nconst y = 2;\n', "utf8");
    const result = await scanCode({ path: dir, pattern: "console.log($ARG)" });
    expect(result).toContain("scanned=2");
    expect(result).toContain("matches=2");
  });

  test("respects maxResults limit", async () => {
    const filePath = `/tmp/acolyte-scan-limit-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    const lines = `${Array.from({ length: 10 }, (_, i) => `console.log("line${i}");`).join("\n")}\n`;
    await writeFile(filePath, lines, "utf8");
    const result = await scanCode({ path: filePath, pattern: "console.log($ARG)", maxResults: 3 });
    expect(result).toContain("matches=3");
  });

  test("blocks paths outside workspace", async () => {
    await expect(scanCode({ path: "/etc/hosts", pattern: "const $X" })).rejects.toThrow(
      "Scan is restricted to the workspace or /tmp",
    );
  });

  test("works in read permission mode", async () => {
    const filePath = `/tmp/acolyte-scan-read-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    await writeFile(filePath, "const x = 1;\n", "utf8");
    setPermissionMode("read");
    const result = await scanCode({ path: filePath, pattern: "const $X = $V" });
    setPermissionMode(initialPermissionMode);
    expect(result).toContain("matches=1");
  });
});
