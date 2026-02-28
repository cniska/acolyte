import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { appConfig, setPermissionMode } from "./app-config";
import { savedPermissionMode } from "./test-factory";
import {
  deleteTextFile,
  editCode,
  editFile,
  fetchWeb,
  readSnippet,
  runShellCommand,
  scanCode,
  writeTextFile,
} from "./tools";

const WS = resolve(process.cwd());
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
    await expect(readSnippet(WS, "/etc/hosts")).rejects.toThrow("Read is restricted to the workspace or /tmp");
  });

  test("editFile blocks paths outside workspace", async () => {
    await expect(
      editFile({
        workspace: WS,
        path: "/etc/hosts",
        edits: [{ find: "a", replace: "b" }],
      }),
    ).rejects.toThrow("Edit is restricted to the workspace or /tmp");
  });

  test("runShellCommand blocks absolute paths outside workspace", async () => {
    await expect(runShellCommand(WS, "echo hi > /etc/acolyte-outside.txt")).rejects.toThrow(
      "Command references path outside workspace and /tmp",
    );
  });

  test("readSnippet allows /tmp files", async () => {
    const filePath = `/tmp/acolyte-tmp-read-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "hello from tmp", "utf8");
    const output = await readSnippet(WS, filePath, "1", "1");
    expect(output).toContain("hello from tmp");
  });

  test("editFile allows /tmp files", async () => {
    const filePath = `/tmp/acolyte-tmp-edit-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha beta", "utf8");
    const output = await editFile({
      workspace: WS,
      path: filePath,
      edits: [{ find: "beta", replace: "gamma" }],
    });
    expect(output).toContain("edits=1");
  });

  test("editFile rejects multi-match find text", async () => {
    const filePath = `/tmp/acolyte-tmp-multi-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "foo bar foo baz foo", "utf8");
    await expect(editFile({ workspace: WS, path: filePath, edits: [{ find: "foo", replace: "qux" }] })).rejects.toThrow(
      "matched 3 locations",
    );
  });

  test("editFile rejects replace text that duplicates content after edit point", async () => {
    const filePath = `/tmp/acolyte-tmp-dup-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "line1\nline2\nline3\nline4\nline5\nline6", "utf8");
    // replace includes line3-line5 which already follow the edit point
    await expect(
      editFile({
        workspace: WS,
        path: filePath,
        edits: [{ find: "line1\nline2", replace: "line1_new\nline2_new\nline3\nline4\nline5" }],
      }),
    ).rejects.toThrow("duplicate content");
  });

  test("runShellCommand allows /tmp paths", async () => {
    const filePath = `/tmp/acolyte-tmp-run-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    const output = await runShellCommand(WS, `printf 'ok' > ${filePath}`);
    expect(output).toContain("exit_code=0");
  });

  test("runShellCommand allows in-workspace commands", async () => {
    const output = await runShellCommand(WS, "printf 'ok'");
    expect(output).toContain("exit_code=0");
    expect(output).toContain("ok");
  });

  test("runShellCommand blocks home paths", async () => {
    await expect(runShellCommand(WS, "cat ~/Documents")).rejects.toThrow(
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
    const restore = savedPermissionMode();
    setPermissionMode("read");
    try {
      await expect(runShellCommand(WS, "printf 'ok'")).rejects.toThrow(
        "Shell command execution is disabled in read mode",
      );
      await expect(
        editFile({
          workspace: WS,
          path: join(process.cwd(), "README.md"),
          edits: [{ find: "Acolyte", replace: "Acolyte" }],
          dryRun: true,
        }),
      ).rejects.toThrow("File editing is disabled in read mode");
    } finally {
      restore();
    }
  });

  test("editFile allows in-workspace edits", async () => {
    const filePath = join(process.cwd(), `tmp-coding-tools-${crypto.randomUUID()}.txt`);
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha beta", "utf8");
    const result = await editFile({
      workspace: WS,
      path: filePath,
      edits: [{ find: "beta", replace: "gamma" }],
    });
    expect(result).toContain("edits=1");
  });

  test("editFile line-range basic replacement", async () => {
    const filePath = `/tmp/acolyte-tmp-lr-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "line1\nline2\nline3\nline4\nline5\n", "utf8");
    const result = await editFile({
      workspace: WS,
      path: filePath,
      edits: [{ startLine: 2, endLine: 3, replace: "replaced2\nreplaced3\n" }],
    });
    expect(result).toContain("edits=1");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("line1\nreplaced2\nreplaced3\nline4\nline5\n");
  });

  test("editFile line-range rejects startLine > endLine", async () => {
    const filePath = `/tmp/acolyte-tmp-lr2-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "a\nb\nc\n", "utf8");
    await expect(
      editFile({ workspace: WS, path: filePath, edits: [{ startLine: 5, endLine: 3, replace: "x" }] }),
    ).rejects.toThrow("startLine (5) must be <= endLine (3)");
  });

  test("editFile line-range clamps endLine beyond file", async () => {
    const filePath = `/tmp/acolyte-tmp-lr3-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "a\nb\nc\n", "utf8");
    // endLine 10 on a 3-line file should clamp to 3 and replace all content
    await editFile({ workspace: WS, path: filePath, edits: [{ startLine: 1, endLine: 10, replace: "x" }] });
    const result = await readFile(filePath, "utf8");
    expect(result).toBe("x");
  });

  test("editFile line-range rejects line numbers < 1", async () => {
    const filePath = `/tmp/acolyte-tmp-lr4-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "a\nb\n", "utf8");
    await expect(
      editFile({ workspace: WS, path: filePath, edits: [{ startLine: 0, endLine: 1, replace: "x" }] }),
    ).rejects.toThrow("Line numbers must be >= 1");
  });

  test("editFile mixed find/replace and line-range", async () => {
    const filePath = `/tmp/acolyte-tmp-lr5-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "aaa\nbbb\nccc\nddd\neee\n", "utf8");
    const result = await editFile({
      workspace: WS,
      path: filePath,
      edits: [
        { find: "aaa", replace: "AAA" },
        { startLine: 4, endLine: 5, replace: "DDD\nEEE\n" },
      ],
    });
    expect(result).toContain("edits=2");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("AAA\nbbb\nccc\nDDD\nEEE\n");
  });

  test("editFile line-range overlapping ranges rejected", async () => {
    const filePath = `/tmp/acolyte-tmp-lr6-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "a\nb\nc\nd\ne\n", "utf8");
    await expect(
      editFile({
        workspace: WS,
        path: filePath,
        edits: [
          { startLine: 1, endLine: 3, replace: "x\n" },
          { startLine: 2, endLine: 4, replace: "y\n" },
        ],
      }),
    ).rejects.toThrow("overlap");
  });

  test("editFile line-range full-file replacement", async () => {
    const filePath = `/tmp/acolyte-tmp-lr7-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    const original = "line1\nline2\nline3\nline4\nline5\n";
    await writeFile(filePath, original, "utf8");
    const result = await editFile({
      workspace: WS,
      path: filePath,
      edits: [{ startLine: 1, endLine: 5, replace: "entirely\nnew\ncontent\n" }],
    });
    expect(result).toContain("edits=1");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("entirely\nnew\ncontent\n");
  });

  test("writeTextFile allows creating /tmp files", async () => {
    const filePath = `/tmp/acolyte-tmp-write-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    const result = await writeTextFile({
      workspace: WS,
      path: filePath,
      content: "hello",
    });
    expect(result).toContain("bytes=5");
  });

  test("writeTextFile blocks paths outside workspace", async () => {
    await expect(
      writeTextFile({
        workspace: WS,
        path: "/etc/acolyte.txt",
        content: "x",
      }),
    ).rejects.toThrow("Write is restricted to the workspace or /tmp");
  });

  test("read mode blocks writeTextFile", async () => {
    const restore = savedPermissionMode();
    setPermissionMode("read");
    try {
      await expect(
        writeTextFile({
          workspace: WS,
          path: join(process.cwd(), `tmp-read-block-${crypto.randomUUID()}.txt`),
          content: "x",
        }),
      ).rejects.toThrow("File writing is disabled in read mode");
    } finally {
      restore();
    }
  });

  test("deleteTextFile deletes /tmp files", async () => {
    const filePath = `/tmp/acolyte-tmp-delete-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha\nbeta\n", "utf8");
    const result = await deleteTextFile({ workspace: WS, path: filePath });
    expect(result).toContain("bytes=");
    await expect(readSnippet(WS, filePath)).rejects.toThrow();
  });

  test("deleteTextFile blocks paths outside workspace", async () => {
    await expect(deleteTextFile({ workspace: WS, path: "/etc/hosts" })).rejects.toThrow(
      "Delete is restricted to the workspace or /tmp",
    );
  });

  test("read mode blocks deleteTextFile", async () => {
    const restore = savedPermissionMode();
    setPermissionMode("read");
    try {
      await expect(deleteTextFile({ workspace: WS, path: join(process.cwd(), "README.md") })).rejects.toThrow(
        "File deletion is disabled in read mode",
      );
    } finally {
      restore();
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
      workspace: WS,
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
      workspace: WS,
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
        workspace: WS,
        path: filePath,
        edits: [{ pattern: "console.log($ARG)", replacement: "logger.debug($ARG)" }],
      }),
    ).rejects.toThrow("No AST matches found");
  });

  test("blocks paths outside workspace", async () => {
    await expect(
      editCode({
        workspace: WS,
        path: "/etc/hosts",
        edits: [{ pattern: "console.log($ARG)", replacement: "logger.debug($ARG)" }],
      }),
    ).rejects.toThrow("AST edit is restricted to the workspace or /tmp");
  });

  test("rejects directory paths", async () => {
    const dirPath = `/tmp/acolyte-ast-dir-${crypto.randomUUID()}`;
    tempDirs.push(dirPath);
    await mkdir(dirPath, { recursive: true });
    await expect(
      editCode({
        workspace: WS,
        path: dirPath,
        edits: [{ pattern: "console.log($ARG)", replacement: "logger.debug($ARG)" }],
      }),
    ).rejects.toThrow("edit-code requires a file path");
  });

  test("read mode blocks editCode", async () => {
    setPermissionMode("read");
    await expect(
      editCode({
        workspace: WS,
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
      workspace: WS,
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
      workspace: WS,
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
      workspace: WS,
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
    const result = await scanCode({ workspace: WS, paths: [filePath], pattern: "console.log($ARG)" });
    expect(result).toContain("scanned=1");
    expect(result).toContain("matches=2");
    expect(result).toContain('$ARG="hello"');
    expect(result).toContain('$ARG="world"');
  });

  test("returns no matches when pattern is absent", async () => {
    const filePath = `/tmp/acolyte-scan-nomatch-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    await writeFile(filePath, "const x = 1;\n", "utf8");
    const result = await scanCode({ workspace: WS, paths: [filePath], pattern: "console.log($ARG)" });
    expect(result).toContain("matches=0");
    expect(result).toContain("No matches.");
  });

  test("scans a directory recursively", async () => {
    const dir = `/tmp/acolyte-scan-dir-${crypto.randomUUID()}`;
    tempDirs.push(dir);
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "a.ts"), 'console.log("a");\n', "utf8");
    await writeFile(join(dir, "sub", "b.ts"), 'console.log("b");\nconst y = 2;\n', "utf8");
    const result = await scanCode({ workspace: WS, paths: [dir], pattern: "console.log($ARG)" });
    expect(result).toContain("scanned=2");
    expect(result).toContain("matches=2");
  });

  test("respects maxResults limit", async () => {
    const filePath = `/tmp/acolyte-scan-limit-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    const lines = `${Array.from({ length: 10 }, (_, i) => `console.log("line${i}");`).join("\n")}\n`;
    await writeFile(filePath, lines, "utf8");
    const result = await scanCode({ workspace: WS, paths: [filePath], pattern: "console.log($ARG)", maxResults: 3 });
    expect(result).toContain("matches=3");
  });

  test("blocks paths outside workspace", async () => {
    await expect(scanCode({ workspace: WS, paths: ["/etc/hosts"], pattern: "const $X" })).rejects.toThrow(
      "Scan is restricted to the workspace or /tmp",
    );
  });

  test("works in read permission mode", async () => {
    const filePath = `/tmp/acolyte-scan-read-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    await writeFile(filePath, "const x = 1;\n", "utf8");
    setPermissionMode("read");
    const result = await scanCode({ workspace: WS, paths: [filePath], pattern: "const $X = $V" });
    setPermissionMode(initialPermissionMode);
    expect(result).toContain("matches=1");
  });

  test("batches multiple patterns and groups output", async () => {
    const filePath = `/tmp/acolyte-scan-batch-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    await writeFile(filePath, 'export function hello() {}\nexport const x = 1;\nconsole.log("test");\n', "utf8");
    const result = await scanCode({
      workspace: WS,
      paths: [filePath],
      pattern: ["export function $NAME() {}", "console.log($ARG)"],
    });
    expect(result).toContain("matches=2");
    expect(result).toContain("--- pattern: export function $NAME() {} ---");
    expect(result).toContain("--- pattern: console.log($ARG) ---");
    expect(result).toContain("$NAME=hello");
    expect(result).toContain('$ARG="test"');
  });

  test("multi-pattern shows No matches per pattern when empty", async () => {
    const filePath = `/tmp/acolyte-scan-batch-empty-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    await writeFile(filePath, "const x = 1;\n", "utf8");
    const result = await scanCode({
      workspace: WS,
      paths: [filePath],
      pattern: ["console.log($ARG)", "import $SPEC from $MOD"],
    });
    expect(result).toContain("matches=0");
    expect(result).toContain("--- pattern: console.log($ARG) ---");
    expect(result).toContain("No matches.");
  });

  test("scans multiple files in one call", async () => {
    const fileA = `/tmp/acolyte-scan-multi-a-${crypto.randomUUID()}.ts`;
    const fileB = `/tmp/acolyte-scan-multi-b-${crypto.randomUUID()}.ts`;
    tempFiles.push(fileA, fileB);
    await writeFile(fileA, "export function foo() {}\n", "utf8");
    await writeFile(fileB, "export function bar() {}\n", "utf8");
    const result = await scanCode({
      workspace: WS,
      paths: [fileA, fileB],
      pattern: "export function $NAME() {}",
    });
    expect(result).toContain("scanned=2");
    expect(result).toContain("matches=2");
    expect(result).toContain("$NAME=foo");
    expect(result).toContain("$NAME=bar");
  });
});
