import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TOOL_ERROR_CODES } from "./error-contract";
import { deleteTextFile, editFile, findFiles, readSnippet, searchFiles, writeTextFile } from "./file-ops";
import { testUuid } from "./test-utils";

const WORKSPACE = resolve(process.cwd());
const tempFiles: string[] = [];
const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempFiles.map(async (f) => rm(f, { force: true })));
  await Promise.all(tempDirs.map(async (d) => rm(d, { recursive: true, force: true })));
});

describe("path guards", () => {
  test("readSnippet blocks paths outside workspace", async () => {
    await expect(readSnippet(WORKSPACE, "/etc/hosts")).rejects.toThrow("restricted to the workspace or /tmp");
  });

  test("editFile blocks paths outside workspace", async () => {
    await expect(
      editFile({ workspace: WORKSPACE, path: "/etc/hosts", edits: [{ find: "a", replace: "b" }] }),
    ).rejects.toThrow("restricted to the workspace or /tmp");
  });

  test("writeTextFile blocks paths outside workspace", async () => {
    await expect(writeTextFile({ workspace: WORKSPACE, path: "/etc/acolyte.txt", content: "x" })).rejects.toThrow(
      "restricted to the workspace or /tmp",
    );
  });

  test("deleteTextFile blocks paths outside workspace", async () => {
    await expect(deleteTextFile({ workspace: WORKSPACE, path: "/etc/hosts" })).rejects.toThrow(
      "restricted to the workspace or /tmp",
    );
  });

  test("readSnippet allows /tmp files", async () => {
    const filePath = `/tmp/acolyte-test-read-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "hello from tmp", "utf8");
    const output = await readSnippet(WORKSPACE, filePath, "1", "1");
    expect(output).toContain("hello from tmp");
  });

  test("editFile allows /tmp files", async () => {
    const filePath = `/tmp/acolyte-test-edit-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha beta", "utf8");
    const output = await editFile({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ find: "beta", replace: "gamma" }],
    });
    expect(output).toContain("edits=1");
  });
});

describe("editFile", () => {
  test("find/replace in workspace file", async () => {
    const filePath = join(WORKSPACE, `tmp-edit-${testUuid()}.txt`);
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha beta", "utf8");
    const result = await editFile({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ find: "beta", replace: "gamma" }],
    });
    expect(result).toContain("edits=1");
  });

  test("rejects multi-match find text", async () => {
    const filePath = `/tmp/acolyte-test-multi-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "foo bar foo baz foo", "utf8");
    await expect(
      editFile({ workspace: WORKSPACE, path: filePath, edits: [{ find: "foo", replace: "qux" }] }),
    ).rejects.toThrow("matched 3 locations");
  });

  test("rejects missing find text with a structured error code", async () => {
    const filePath = `/tmp/acolyte-test-not-found-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha beta", "utf8");
    await expect(
      editFile({ workspace: WORKSPACE, path: filePath, edits: [{ find: "gamma", replace: "delta" }] }),
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.editFileFindNotFound });
  });

  test("emits structured recovery metadata for bounded edit failures", async () => {
    const filePath = `/tmp/acolyte-test-recovery-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha beta", "utf8");
    await expect(
      editFile({ workspace: WORKSPACE, path: filePath, edits: [{ find: "gamma", replace: "delta" }] }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editFileFindNotFound,
      recovery: {
        tool: "edit-file",
        kind: "refresh-snippet",
        nextTool: "read-file",
        targetPaths: [filePath],
      },
    });
  });

  test("allows a tiny whole-file snippet when it is only a few lines", async () => {
    const filePath = `/tmp/acolyte-test-small-snippet-${crypto.randomUUID()}.md`;
    tempFiles.push(filePath);
    await writeFile(filePath, "# Demo\n\n## Documentation\n- [Contributing](CONTRIBUTING.md)\n", "utf8");

    const result = await editFile({
      workspace: WORKSPACE,
      path: filePath,
      edits: [
        {
          find: "# Demo\n\n## Documentation\n- [Contributing](CONTRIBUTING.md)\n",
          replace: "# Demo\n\n## Documentation\n- [Contributing](docs/contributing.md)\n",
        },
      ],
    });

    expect(result).toContain("edits=1");
    await expect(readFile(filePath, "utf8")).resolves.toContain("docs/contributing.md");
  });

  test("rejects long find snippets even when they are unique", async () => {
    const filePath = `/tmp/acolyte-test-long-snippet-${crypto.randomUUID()}.txt`;
    tempFiles.push(filePath);
    const content = Array.from({ length: 10 }, (_, index) => `line-${index + 1}`).join("\n");
    await writeFile(filePath, `${content}\n`, "utf8");

    await expect(
      editFile({
        workspace: WORKSPACE,
        path: filePath,
        edits: [{ find: `${content}\n`, replace: "short\n" }],
      }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editFileFindTooLarge,
      recovery: {
        tool: "edit-file",
        kind: "shrink-edit",
        nextTool: "read-file",
        targetPaths: [filePath],
      },
    });
  });

  test("rejects oversized replace blocks for find-based edits", async () => {
    const filePath = `/tmp/acolyte-test-large-replace-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    const content = Array.from({ length: 40 }, (_, index) => `line-${index + 1}`).join("\n");
    await writeFile(filePath, `${content}\n`, "utf8");

    await expect(
      editFile({
        workspace: WORKSPACE,
        path: filePath,
        edits: [
          {
            find: "line-2\nline-3\nline-4",
            replace: `${content}\n`,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.editFileReplaceTooLarge });
  });

  test("rejects batched find edits that rewrite too much of the file", async () => {
    const filePath = `/tmp/acolyte-test-batch-rewrite-${crypto.randomUUID()}.ts`;
    tempFiles.push(filePath);
    const content = Array.from({ length: 40 }, (_, index) => `line-${index + 1}`).join("\n");
    await writeFile(filePath, `${content}\n`, "utf8");

    await expect(
      editFile({
        workspace: WORKSPACE,
        path: filePath,
        edits: Array.from({ length: 33 }, (_, index) => ({
          find: `line-${index + 1}\n`,
          replace: `updated-${index + 1}\n`,
        })),
      }),
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.editFileBatchTooLarge });
  });

  test("rejects replace text that duplicates content after edit point", async () => {
    const filePath = `/tmp/acolyte-test-dup-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "line1\nline2\nline3\nline4\nline5\nline6", "utf8");
    await expect(
      editFile({
        workspace: WORKSPACE,
        path: filePath,
        edits: [{ find: "line1\nline2", replace: "line1_new\nline2_new\nline3\nline4\nline5" }],
      }),
    ).rejects.toThrow("duplicate content");
  });

  test("line-range basic replacement", async () => {
    const filePath = `/tmp/acolyte-test-lr-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "line1\nline2\nline3\nline4\nline5\n", "utf8");
    const result = await editFile({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ startLine: 2, endLine: 3, replace: "replaced2\nreplaced3\n" }],
    });
    expect(result).toContain("edits=1");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("line1\nreplaced2\nreplaced3\nline4\nline5\n");
  });

  test("line-range rejects startLine > endLine", async () => {
    const filePath = `/tmp/acolyte-test-lr2-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "a\nb\nc\n", "utf8");
    await expect(
      editFile({ workspace: WORKSPACE, path: filePath, edits: [{ startLine: 5, endLine: 3, replace: "x" }] }),
    ).rejects.toThrow("startLine (5) must be <= endLine (3)");
  });

  test("line-range clamps endLine beyond file", async () => {
    const filePath = `/tmp/acolyte-test-lr3-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "a\nb\nc\n", "utf8");
    await editFile({ workspace: WORKSPACE, path: filePath, edits: [{ startLine: 1, endLine: 10, replace: "x" }] });
    const result = await readFile(filePath, "utf8");
    expect(result).toBe("x");
  });

  test("line-range rejects line numbers < 1", async () => {
    const filePath = `/tmp/acolyte-test-lr4-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "a\nb\n", "utf8");
    await expect(
      editFile({ workspace: WORKSPACE, path: filePath, edits: [{ startLine: 0, endLine: 1, replace: "x" }] }),
    ).rejects.toThrow("Line numbers must be >= 1");
  });

  test("mixed find/replace and line-range", async () => {
    const filePath = `/tmp/acolyte-test-lr5-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "aaa\nbbb\nccc\nddd\neee\n", "utf8");
    const result = await editFile({
      workspace: WORKSPACE,
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

  test("line-range overlapping ranges rejected", async () => {
    const filePath = `/tmp/acolyte-test-lr6-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "a\nb\nc\nd\ne\n", "utf8");
    await expect(
      editFile({
        workspace: WORKSPACE,
        path: filePath,
        edits: [
          { startLine: 1, endLine: 3, replace: "x\n" },
          { startLine: 2, endLine: 4, replace: "y\n" },
        ],
      }),
    ).rejects.toThrow("overlap");
  });

  test("line-range full-file replacement", async () => {
    const filePath = `/tmp/acolyte-test-lr7-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "line1\nline2\nline3\nline4\nline5\n", "utf8");
    const result = await editFile({
      workspace: WORKSPACE,
      path: filePath,
      edits: [{ startLine: 1, endLine: 5, replace: "entirely\nnew\ncontent\n" }],
    });
    expect(result).toContain("edits=1");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("entirely\nnew\ncontent\n");
  });

  test("line-range rejects whole-file clear edits", async () => {
    const filePath = `/tmp/acolyte-test-lr8-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "line1\nline2\nline3\n", "utf8");
    await expect(
      editFile({
        workspace: WORKSPACE,
        path: filePath,
        edits: [{ startLine: 1, endLine: 99, replace: "" }],
      }),
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.editFileLineRangeTooLarge });
  });
});

describe("searchFiles", () => {
  test("returns structured recovery when scoped paths resolve to no files", async () => {
    await expect(searchFiles(WORKSPACE, ["alias"], 20, ["src/does-not-exist"])).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.searchFilesEmptyScope,
      recovery: {
        tool: "search-files",
        kind: "broaden-scope",
        nextTool: "find-files",
        resolvesOn: [{ tool: "find-files" }],
      },
    });
  });

  test("returns structured recovery when a scoped file has no matches", async () => {
    const filePath = join(WORKSPACE, `tmp-search-no-match-${testUuid()}.txt`);
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha beta\n", "utf8");
    await expect(searchFiles(WORKSPACE, ["gamma"], 20, [filePath])).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.searchFilesNoMatch,
      recovery: {
        tool: "search-files",
        kind: "switch-to-read",
        nextTool: "read-file",
        targetPaths: [filePath],
        resolvesOn: [{ tool: "read-file" }],
      },
    });
  });
});

describe("writeTextFile", () => {
  test("creates /tmp files", async () => {
    const filePath = `/tmp/acolyte-test-write-${testUuid()}.txt`;
    tempFiles.push(filePath);
    const result = await writeTextFile({ workspace: WORKSPACE, path: filePath, content: "hello" });
    expect(result).toContain("bytes=5");
  });
});

describe("deleteTextFile", () => {
  test("deletes /tmp files", async () => {
    const filePath = `/tmp/acolyte-test-delete-${testUuid()}.txt`;
    tempFiles.push(filePath);
    await writeFile(filePath, "alpha\nbeta\n", "utf8");
    const result = await deleteTextFile({ workspace: WORKSPACE, path: filePath });
    expect(result).toContain("bytes=");
    await expect(readSnippet(WORKSPACE, filePath)).rejects.toThrow();
  });
});

describe("searchFiles", () => {
  test("scopes matches to a single file path", async () => {
    const dir = join(WORKSPACE, `acolyte-test-search-${testUuid()}`);
    tempDirs.push(dir);
    await mkdir(dir, { recursive: true });
    const first = join(dir, "first.ts");
    const second = join(dir, "second.ts");
    await writeFile(first, 'export const first = "needle";\n', "utf8");
    await writeFile(second, 'export const second = "needle";\n', "utf8");
    const result = await searchFiles(WORKSPACE, ["needle"], 20, [first]);
    expect(result).toContain("first.ts:1:");
    expect(result).not.toContain("second.ts");
  });

  test("scopes matches to a directory path", async () => {
    const dir = join(WORKSPACE, `acolyte-test-search-dir-${testUuid()}`);
    tempDirs.push(dir);
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "sub", "inside.ts"), 'export const inside = "needle";\n', "utf8");
    const outside = join(WORKSPACE, `acolyte-test-search-outside-${testUuid()}.ts`);
    tempFiles.push(outside);
    await writeFile(outside, 'export const outside = "needle";\n', "utf8");
    const result = await searchFiles(WORKSPACE, ["needle"], 20, [dir]);
    expect(result).toContain("inside.ts:1:");
    expect(result).not.toContain(outside.split("/").at(-1) ?? "");
  });
});

describe("findFiles", () => {
  test("finds files by pattern in workspace", async () => {
    const result = await findFiles(WORKSPACE, ["package.json"]);
    expect(result).toContain("package.json");
  });

  test("rejects empty patterns", async () => {
    await expect(findFiles(WORKSPACE, [])).rejects.toThrow("At least one pattern is required");
  });
});
