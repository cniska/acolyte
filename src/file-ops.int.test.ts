import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "./error-contract";
import { FILE_READ_MAX_BYTES, FILE_READ_MAX_TOKENS, readFileContent } from "./file-ops";
import { tempDir, testUuid } from "./test-utils";
import { ensureRealTokenEncoder, estimateTokens } from "./token-estimate";
import { toolsForAgent } from "./tool-registry";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

describe("path validation — fs", () => {
  test("readFile allows workspace files", async () => {
    const workspace = dirs.createDir("acolyte-read-ws-");
    const filePath = join(workspace, `test-read-${testUuid()}.txt`);
    await writeFile(filePath, "hello from workspace", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.readFile.execute({ path: filePath }, "call_read_ws");
    expect(result.result.output).toContain("hello from workspace");
  });

  test("readFile returns the whole file by default", async () => {
    const workspace = dirs.createDir("acolyte-read-tool-whole-");
    const filePath = join(workspace, `test-read-tool-whole-${testUuid()}.txt`);
    const lines = Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(filePath, lines, "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.readFile.execute({ path: filePath }, "call_read_whole");
    expect(result.result.offset).toBeUndefined();
    expect(result.result.limit).toBeUndefined();
    expect(result.result.totalLines).toBe(6);
    expect(result.result.output).toContain("Lines: 1-6 of 6");
    expect(result.result.output).toContain("6: line 6");
  });

  test("readFile returns an offset/limit range", async () => {
    const workspace = dirs.createDir("acolyte-read-tool-range-");
    const filePath = join(workspace, `test-read-tool-range-${testUuid()}.txt`);
    const lines = Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(filePath, lines, "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.readFile.execute({ path: filePath, offset: 2, limit: 3 }, "call_read_range");
    expect(result.result.offset).toBe(2);
    expect(result.result.limit).toBe(3);
    expect(result.result.totalLines).toBe(6);
    expect(result.result.output).toContain("Lines: 2-4 of 6");
    expect(result.result.output).toContain("2: line 2");
    expect(result.result.output).not.toContain("5: line 5");
  });

  test("readFileContent returns the whole file with absolute numbering and a full-range header", async () => {
    const workspace = dirs.createDir("acolyte-read-whole-");
    const filePath = join(workspace, `test-whole-${testUuid()}.txt`);
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(filePath, lines, "utf8");
    const read = await readFileContent(workspace, filePath);
    expect(read.totalLines).toBe(12);
    expect(read.startLine).toBe(1);
    expect(read.endLine).toBe(12);
    expect(read.output).toContain("Lines: 1-12 of 12");
    expect(read.output).toContain("1: line 1");
    expect(read.output).toContain("12: line 12");
  });

  test("readFileContent counts a trailing newline as a terminator, not another line", async () => {
    const workspace = dirs.createDir("acolyte-read-trailing-newline-");
    const filePath = join(workspace, `test-trailing-newline-${testUuid()}.txt`);
    await writeFile(filePath, "line 1\nline 2\nline 3\n", "utf8");
    const read = await readFileContent(workspace, filePath);
    expect(read.totalLines).toBe(3);
    expect(read.output).toContain("Lines: 1-3 of 3");
    expect(read.output).not.toContain("4: ");
  });

  test("readFileContent keeps a final line that has content but no newline", async () => {
    const workspace = dirs.createDir("acolyte-read-no-trailing-newline-");
    const filePath = join(workspace, `test-no-trailing-newline-${testUuid()}.txt`);
    await writeFile(filePath, "line 1\nline 2", "utf8");
    const read = await readFileContent(workspace, filePath);
    expect(read.totalLines).toBe(2);
    expect(read.output).toContain("2: line 2");
  });

  test("readFileContent reports an empty file as having no lines", async () => {
    const workspace = dirs.createDir("acolyte-read-empty-");
    const filePath = join(workspace, `test-empty-${testUuid()}.txt`);
    await writeFile(filePath, "", "utf8");
    const read = await readFileContent(workspace, filePath);
    expect(read.totalLines).toBe(0);
    expect(read.output).toContain("Lines: 0-0 of 0");
    expect(read.output).not.toContain("1: ");
  });

  test("readFileContent treats offset as a 1-based line and limit as a line count", async () => {
    const workspace = dirs.createDir("acolyte-read-range-");
    const filePath = join(workspace, `test-range-${testUuid()}.txt`);
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(filePath, lines, "utf8");
    const read = await readFileContent(workspace, filePath, { offset: 4, limit: 2 });
    expect(read.output).toContain("Lines: 4-5 of 10");
    expect(read.output).toContain("4: line 4");
    expect(read.output).toContain("5: line 5");
    expect(read.output).not.toContain("3: line 3");
    expect(read.output).not.toContain("6: line 6");
  });

  test("readFileContent reads to the end when only offset is given", async () => {
    const workspace = dirs.createDir("acolyte-read-offset-only-");
    const filePath = join(workspace, `test-offset-only-${testUuid()}.txt`);
    await writeFile(filePath, "line 1\nline 2\nline 3", "utf8");
    const read = await readFileContent(workspace, filePath, { offset: 2 });
    expect(read.output).toContain("Lines: 2-3 of 3");
    expect(read.output).not.toContain("1: line 1");
  });

  test("readFileContent clamps a limit past the end and reports the served range", async () => {
    const workspace = dirs.createDir("acolyte-read-range-clamp-");
    const filePath = join(workspace, `test-range-clamp-${testUuid()}.txt`);
    await writeFile(filePath, "line 1\nline 2\nline 3", "utf8");
    const read = await readFileContent(workspace, filePath, { offset: 2, limit: 500 });
    expect(read.endLine).toBe(3);
    expect(read.output).toContain("Lines: 2-3 of 3");
  });

  test("readFileContent rejects an offset past the end of the file", async () => {
    const workspace = dirs.createDir("acolyte-read-range-invalid-");
    const filePath = join(workspace, `test-range-invalid-${testUuid()}.txt`);
    await writeFile(filePath, "line 1\nline 2\nline 3", "utf8");
    await expect(readFileContent(workspace, filePath, { offset: 4 })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.readFileRangeInvalid,
    });
    await expect(readFileContent(workspace, filePath, { offset: 0 })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.readFileRangeInvalid,
    });
    await expect(readFileContent(workspace, filePath, { limit: 0 })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.readFileRangeInvalid,
    });
  });

  test("readFileContent rejects a file over the byte ceiling before reading it", async () => {
    const workspace = dirs.createDir("acolyte-read-bytes-");
    const filePath = join(workspace, `test-bytes-${testUuid()}.txt`);
    await writeFile(filePath, Buffer.alloc(FILE_READ_MAX_BYTES + 1, 0x61));
    await expect(readFileContent(workspace, filePath)).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.readFileTooLarge,
    });
  });

  test("readFileContent rejects output over the token ceiling and names the line count", async () => {
    const workspace = dirs.createDir("acolyte-read-tokens-");
    const filePath = join(workspace, `test-tokens-${testUuid()}.txt`);
    const lines = Array.from({ length: 20_000 }, (_, i) => `const value${i} = ${i};`).join("\n");
    await writeFile(filePath, lines, "utf8");
    const error = await readFileContent(workspace, filePath).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: TOOL_ERROR_CODES.readFileTooLarge });
    // The line count is the model's retry payload: it cannot pick a range without it.
    expect((error as Error).message).toContain("20000 lines");
  });

  test("readFileContent counts the numbered output, not the raw file, against the token ceiling", async () => {
    const workspace = dirs.createDir("acolyte-read-tokens-numbered-");
    const filePath = join(workspace, `test-tokens-numbered-${testUuid()}.txt`);
    await ensureRealTokenEncoder();
    const lines = Array.from({ length: 9_000 }, () => "x").join("\n");
    await writeFile(filePath, lines, "utf8");
    // The raw content fits the ceiling; the "N: " line prefixes are what push it over.
    expect(estimateTokens(lines)).toBeLessThanOrEqual(FILE_READ_MAX_TOKENS);
    await expect(readFileContent(workspace, filePath)).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.readFileTooLarge,
    });
  });

  test("editFile allows workspace files", async () => {
    const workspace = dirs.createDir("acolyte-edit-ws-");
    const filePath = join(workspace, `test-edit-${testUuid()}.txt`);
    await writeFile(filePath, "alpha beta", "utf8");
    const { tools, session } = toolsForAgent({ workspace });
    const result = await tools.editFile.execute(
      { path: filePath, edits: [{ find: "beta", replace: "gamma" }] },
      "call_edit_ws",
    );
    expect(result.result.output).toContain("edits=1");
    expect(session.callLog[0]?.toolName).toBe("file-edit");
  });
});

describe("editFile", () => {
  test("find/replace in workspace file", async () => {
    const workspace = dirs.createDir("acolyte-edit-fr-");
    const filePath = join(workspace, `tmp-edit-${testUuid()}.txt`);
    await writeFile(filePath, "alpha beta", "utf8");
    const { tools, session } = toolsForAgent({ workspace });
    const result = await tools.editFile.execute(
      { path: filePath, edits: [{ find: "beta", replace: "gamma" }] },
      "call_edit_fr",
    );
    expect(result.result.output).toContain("edits=1");
    expect(session.callLog).toHaveLength(1);
  });

  test("rejects multi-match find text", async () => {
    const workspace = dirs.createDir("acolyte-edit-multi-");
    const filePath = join(workspace, `test-multi-${testUuid()}.txt`);
    await writeFile(filePath, "foo bar foo baz foo", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editFile.execute({ path: filePath, edits: [{ find: "foo", replace: "qux" }] }, "call_edit_multi"),
    ).rejects.toThrow("matched 3 locations");
  });

  test("rejects missing find text with a structured error code", async () => {
    const workspace = dirs.createDir("acolyte-edit-nf-");
    const filePath = join(workspace, `test-not-found-${testUuid()}.txt`);
    await writeFile(filePath, "alpha beta", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editFile.execute({ path: filePath, edits: [{ find: "gamma", replace: "delta" }] }, "call_edit_nf"),
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.editFileFindNotFound });
  });

  test("emits structured recovery metadata for bounded edit failures", async () => {
    const workspace = dirs.createDir("acolyte-edit-recovery-");
    const filePath = join(workspace, `test-recovery-${testUuid()}.txt`);
    await writeFile(filePath, "alpha beta", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editFile.execute({ path: filePath, edits: [{ find: "gamma", replace: "delta" }] }, "call_edit_recovery"),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editFileFindNotFound,
    });
  });

  test("allows a tiny whole-file snippet when it is only a few lines", async () => {
    const workspace = dirs.createDir("acolyte-edit-snippet-");
    const filePath = join(workspace, `test-small-snippet-${crypto.randomUUID()}.md`);
    await writeFile(filePath, "# Demo\n\n## Documentation\n- [Contributing](CONTRIBUTING.md)\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editFile.execute(
      {
        path: filePath,
        edits: [
          {
            find: "# Demo\n\n## Documentation\n- [Contributing](CONTRIBUTING.md)\n",
            replace: "# Demo\n\n## Documentation\n- [Contributing](docs/contributing.md)\n",
          },
        ],
      },
      "call_edit_snippet",
    );
    expect(result.result.output).toContain("edits=1");
    await expect(readFile(filePath, "utf8")).resolves.toContain("docs/contributing.md");
  });

  test("rejects long find snippets even when they are unique", async () => {
    const workspace = dirs.createDir("acolyte-edit-longsnip-");
    const filePath = join(workspace, `test-long-snippet-${crypto.randomUUID()}.txt`);
    const content = Array.from({ length: 10 }, (_, index) => `line-${index + 1}`).join("\n");
    await writeFile(filePath, `${content}\n`, "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editFile.execute(
        { path: filePath, edits: [{ find: `${content}\n`, replace: "short\n" }] },
        "call_edit_longsnip",
      ),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.editFileFindTooLarge,
    });
  });

  test("rejects oversized replace blocks for find-based edits", async () => {
    const workspace = dirs.createDir("acolyte-edit-largerepl-");
    const filePath = join(workspace, `test-large-replace-${crypto.randomUUID()}.ts`);
    const content = Array.from({ length: 40 }, (_, index) => `line-${index + 1}`).join("\n");
    await writeFile(filePath, `${content}\n`, "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editFile.execute(
        {
          path: filePath,
          edits: [
            {
              find: "line-2\nline-3\nline-4",
              replace: `${content}\n`,
            },
          ],
        },
        "call_edit_largerepl",
      ),
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.editFileReplaceTooLarge });
  });

  test("rejects batched find edits that rewrite too much of the file", async () => {
    const workspace = dirs.createDir("acolyte-edit-batchrw-");
    const filePath = join(workspace, `test-batch-rewrite-${crypto.randomUUID()}.ts`);
    const content = Array.from({ length: 40 }, (_, index) => `line-${index + 1}`).join("\n");
    await writeFile(filePath, `${content}\n`, "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editFile.execute(
        {
          path: filePath,
          edits: Array.from({ length: 33 }, (_, index) => ({
            find: `line-${index + 1}\n`,
            replace: `updated-${index + 1}\n`,
          })),
        },
        "call_edit_batchrw",
      ),
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.editFileBatchTooLarge });
  });

  test("rejects replace text that duplicates content after edit point", async () => {
    const workspace = dirs.createDir("acolyte-edit-dup-");
    const filePath = join(workspace, `test-dup-${testUuid()}.txt`);
    await writeFile(filePath, "line1\nline2\nline3\nline4\nline5\nline6", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editFile.execute(
        { path: filePath, edits: [{ find: "line1\nline2", replace: "line1_new\nline2_new\nline3\nline4\nline5" }] },
        "call_edit_dup",
      ),
    ).rejects.toThrow("duplicate content");
  });

  test("line-range basic replacement", async () => {
    const workspace = dirs.createDir("acolyte-edit-lr-");
    const filePath = join(workspace, `test-lr-${testUuid()}.txt`);
    await writeFile(filePath, "line1\nline2\nline3\nline4\nline5\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editFile.execute(
      { path: filePath, edits: [{ startLine: 2, endLine: 3, replace: "replaced2\nreplaced3\n" }] },
      "call_edit_lr",
    );
    expect(result.result.output).toContain("edits=1");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("line1\nreplaced2\nreplaced3\nline4\nline5\n");
  });

  test("line-range rejects startLine > endLine", async () => {
    const workspace = dirs.createDir("acolyte-edit-lr2-");
    const filePath = join(workspace, `test-lr2-${testUuid()}.txt`);
    await writeFile(filePath, "a\nb\nc\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editFile.execute({ path: filePath, edits: [{ startLine: 5, endLine: 3, replace: "x" }] }, "call_edit_lr2"),
    ).rejects.toThrow("startLine (5) must be <= endLine (3)");
  });

  test("line-range clamps endLine beyond file", async () => {
    const workspace = dirs.createDir("acolyte-edit-lr3-");
    const filePath = join(workspace, `test-lr3-${testUuid()}.txt`);
    await writeFile(filePath, "a\nb\nc\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await tools.editFile.execute(
      { path: filePath, edits: [{ startLine: 1, endLine: 10, replace: "x" }] },
      "call_edit_lr3",
    );
    const result = await readFile(filePath, "utf8");
    expect(result).toBe("x");
  });

  test("line-range rejects line numbers < 1", async () => {
    const workspace = dirs.createDir("acolyte-edit-lr4-");
    const filePath = join(workspace, `test-lr4-${testUuid()}.txt`);
    await writeFile(filePath, "a\nb\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editFile.execute({ path: filePath, edits: [{ startLine: 0, endLine: 1, replace: "x" }] }, "call_edit_lr4"),
    ).rejects.toThrow("Line numbers must be >= 1");
  });

  test("mixed find/replace and line-range", async () => {
    const workspace = dirs.createDir("acolyte-edit-lr5-");
    const filePath = join(workspace, `test-lr5-${testUuid()}.txt`);
    await writeFile(filePath, "aaa\nbbb\nccc\nddd\neee\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editFile.execute(
      {
        path: filePath,
        edits: [
          { find: "aaa", replace: "AAA" },
          { startLine: 4, endLine: 5, replace: "DDD\nEEE\n" },
        ],
      },
      "call_edit_lr5",
    );
    expect(result.result.output).toContain("edits=2");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("AAA\nbbb\nccc\nDDD\nEEE\n");
  });

  test("line-range overlapping ranges rejected", async () => {
    const workspace = dirs.createDir("acolyte-edit-lr6-");
    const filePath = join(workspace, `test-lr6-${testUuid()}.txt`);
    await writeFile(filePath, "a\nb\nc\nd\ne\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editFile.execute(
        {
          path: filePath,
          edits: [
            { startLine: 1, endLine: 3, replace: "x\n" },
            { startLine: 2, endLine: 4, replace: "y\n" },
          ],
        },
        "call_edit_lr6",
      ),
    ).rejects.toThrow("overlap");
  });

  test("line-range full-file replacement", async () => {
    const workspace = dirs.createDir("acolyte-edit-lr7-");
    const filePath = join(workspace, `test-lr7-${testUuid()}.txt`);
    await writeFile(filePath, "line1\nline2\nline3\nline4\nline5\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.editFile.execute(
      { path: filePath, edits: [{ startLine: 1, endLine: 5, replace: "entirely\nnew\ncontent\n" }] },
      "call_edit_lr7",
    );
    expect(result.result.output).toContain("edits=1");
    const content = await readFile(filePath, "utf8");
    expect(content).toBe("entirely\nnew\ncontent\n");
  });

  test("line-range rejects whole-file clear edits", async () => {
    const workspace = dirs.createDir("acolyte-edit-lr8-");
    const filePath = join(workspace, `test-lr8-${testUuid()}.txt`);
    await writeFile(filePath, "line1\nline2\nline3\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.editFile.execute({ path: filePath, edits: [{ startLine: 1, endLine: 99, replace: "" }] }, "call_edit_lr8"),
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.editFileLineRangeTooLarge });
  });

  test("line-range rejects a whole-file clear stated in the line numbers a read reports", async () => {
    const workspace = dirs.createDir("acolyte-edit-lr9-");
    const filePath = join(workspace, `test-lr9-${testUuid()}.txt`);
    await writeFile(filePath, "line1\nline2\nline3\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    // A read of this file reports 3 lines, so 1-3 is the honest way to name every line.
    await expect(
      tools.editFile.execute({ path: filePath, edits: [{ startLine: 1, endLine: 3, replace: "" }] }, "call_edit_lr9"),
    ).rejects.toMatchObject({ code: TOOL_ERROR_CODES.editFileLineRangeTooLarge });
  });
});

describe("searchFiles", () => {
  test("rejects when a scoped file has no matches", async () => {
    const workspace = dirs.createDir("acolyte-search-nomatch-");
    const filePath = join(workspace, `tmp-search-no-match-${testUuid()}.txt`);
    await writeFile(filePath, "alpha beta\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.searchFiles.execute({ pattern: "gamma", path: filePath }, "call_search_nomatch"),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.searchFilesNoMatch,
    });
  });

  test("scopes matches to a single file path", async () => {
    const workspace = dirs.createDir("acolyte-search-scope-");
    const dir = join(workspace, "sub");
    await mkdir(dir, { recursive: true });
    const first = join(dir, "first.ts");
    const second = join(dir, "second.ts");
    await writeFile(first, 'export const first = "needle";\n', "utf8");
    await writeFile(second, 'export const second = "needle";\n', "utf8");
    const { tools, session } = toolsForAgent({ workspace });
    const result = await tools.searchFiles.execute({ pattern: "needle", path: first }, "call_search_scope");
    expect(result.result.output).toContain("first.ts:1:");
    expect(result.result.output).not.toContain("second.ts");
    expect(session.callLog[0]?.toolName).toBe("file-search");
  });

  test("scopes matches to a directory path", async () => {
    const workspace = dirs.createDir("acolyte-search-dir-");
    await mkdir(join(workspace, "sub"), { recursive: true });
    await writeFile(join(workspace, "sub", "inside.ts"), 'export const inside = "needle";\n', "utf8");
    const outsideFile = join(workspace, `outside-${testUuid()}.ts`);
    await writeFile(outsideFile, 'export const outside = "needle";\n', "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.searchFiles.execute(
      { pattern: "needle", path: join(workspace, "sub") },
      "call_search_dir",
    );
    expect(result.result.output).toContain("inside.ts:1:");
    expect(result.result.output).not.toContain("outside");
  });

  test("accepts canonical absolute paths inside a symlinked workspace root", async () => {
    const root = dirs.createDir("acolyte-search-sandbox-");
    const realWorkspace = join(root, "real-workspace");
    const linkWorkspace = join(root, "workspace-link");
    const filePath = join(realWorkspace, "inside.ts");
    await mkdir(realWorkspace, { recursive: true });
    await writeFile(filePath, 'export const inside = "needle";\n', "utf8");
    await symlink(realWorkspace, linkWorkspace);
    const { tools } = toolsForAgent({ workspace: linkWorkspace });
    const result = await tools.searchFiles.execute({ pattern: "needle", path: filePath }, "call_search_symlink");
    expect(result.result.output).toContain("inside.ts:1:");
  });
});

describe("findFiles", () => {
  async function workspaceWithToolkits(): Promise<string> {
    const workspace = dirs.createDir("acolyte-find-glob-");
    await mkdir(join(workspace, "src", "tui"), { recursive: true });
    for (const rel of [
      "src/agent-toolkit.ts",
      "src/file-toolkit.ts",
      "src/file-ops.ts",
      "src/cli-tool.ts",
      "src/tui/tool-render.tsx",
      "docs.md",
    ]) {
      await writeFile(join(workspace, rel), "export const x = 1;\n", "utf8");
    }
    return workspace;
  }

  test("matches a path prefix combined with a mid-segment wildcard", async () => {
    const workspace = await workspaceWithToolkits();
    const { tools, session } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "src/*-toolkit.ts" }, "call_find_prefixed_glob");
    expect(result.result.paths.sort()).toEqual(["./src/agent-toolkit.ts", "./src/file-toolkit.ts"]);
    expect(session.callLog[0]?.toolName).toBe("file-find");
  });

  test("matches a bare wildcard pattern at any depth", async () => {
    const workspace = await workspaceWithToolkits();
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "*-toolkit.ts" }, "call_find_bare_glob");
    expect(result.result.paths.sort()).toEqual(["./src/agent-toolkit.ts", "./src/file-toolkit.ts"]);
  });

  test("keeps a wildcard within one path segment", async () => {
    const workspace = await workspaceWithToolkits();
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "src/*tool*" }, "call_find_fragment_glob");
    expect(result.result.paths.sort()).toEqual([
      "./src/agent-toolkit.ts",
      "./src/cli-tool.ts",
      "./src/file-toolkit.ts",
    ]);
  });

  test("matches a wildcard-free pattern as a substring", async () => {
    const workspace = await workspaceWithToolkits();
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "toolkit" }, "call_find_substring");
    expect(result.result.paths.sort()).toEqual(["./src/agent-toolkit.ts", "./src/file-toolkit.ts"]);
  });

  test("expands brace alternation", async () => {
    const workspace = await workspaceWithToolkits();
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "src/**/*.{ts,tsx}" }, "call_find_braces");
    expect(result.result.paths.sort()).toEqual([
      "./src/agent-toolkit.ts",
      "./src/cli-tool.ts",
      "./src/file-ops.ts",
      "./src/file-toolkit.ts",
      "./src/tui/tool-render.tsx",
    ]);
  });

  test("resolves an absolute pattern against the workspace root", async () => {
    const workspace = await workspaceWithToolkits();
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute(
      { pattern: join(workspace, "src", "*-toolkit.ts") },
      "call_find_absolute",
    );
    expect(result.result.paths.sort()).toEqual(["./src/agent-toolkit.ts", "./src/file-toolkit.ts"]);
  });

  test("resolves an absolute path with no wildcard to that one file", async () => {
    const workspace = await workspaceWithToolkits();
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute(
      { pattern: join(workspace, "src", "file-ops.ts") },
      "call_find_absolute_exact",
    );
    expect(result.result.paths).toEqual(["./src/file-ops.ts"]);
  });

  test("anchors a leading-slash pattern at the workspace root", async () => {
    const workspace = await workspaceWithToolkits();
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "/src/*-toolkit.ts" }, "call_find_root_anchored");
    expect(result.result.paths.sort()).toEqual(["./src/agent-toolkit.ts", "./src/file-toolkit.ts"]);
  });

  test("matches nothing for an absolute pattern outside the workspace", async () => {
    const workspace = await workspaceWithToolkits();
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "/etc/*.conf" }, "call_find_outside");
    expect(result.result.paths).toEqual([]);
    expect(result.result.matches).toBe(0);
  });

  test("reports how many matches were withheld when results are capped", async () => {
    const workspace = dirs.createDir("acolyte-find-truncate-");
    await mkdir(join(workspace, "src"), { recursive: true });
    for (let i = 0; i < 45; i++) {
      await writeFile(join(workspace, "src", `mod-${String(i).padStart(2, "0")}.ts`), "export const x = 1;\n", "utf8");
    }
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "src/*.ts" }, "call_find_truncated");
    expect(result.result.paths).toHaveLength(40);
    expect(result.result.matches).toBe(45);
    expect(result.result.truncated).toBe(true);
    expect(result.result.output).toContain("45 files matched, showing the first 40");
  });

  test("reports when the workspace scan withholds matches", async () => {
    const workspace = dirs.createDir("acolyte-find-scan-cap-");
    await mkdir(join(workspace, "src"), { recursive: true });
    await Promise.all(
      Array.from({ length: 5001 }, (_, i) =>
        writeFile(join(workspace, "src", `mod-${String(i).padStart(4, "0")}.ts`), "export const x = 1;\n", "utf8"),
      ),
    );
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "src/*.ts" }, "call_find_scan_capped");
    expect(result.result.paths).toHaveLength(40);
    expect(result.result.matches).toBe(5000);
    expect(result.result.truncated).toBe(true);
    expect(result.result.output).toContain("At least 5000 files matched, showing the first 40");
  });

  test("does not report no matches as complete when the workspace scan is capped", async () => {
    const workspace = dirs.createDir("acolyte-find-scan-no-match-");
    await mkdir(join(workspace, "src"), { recursive: true });
    await Promise.all(
      Array.from({ length: 5000 }, (_, i) =>
        writeFile(join(workspace, "src", `mod-${String(i).padStart(4, "0")}.ts`), "export const x = 1;\n", "utf8"),
      ),
    );
    await writeFile(join(workspace, "src", "target.ts"), "export const target = 1;\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "target.ts" }, "call_find_scan_no_match");
    expect(result.result.matches).toBe(0);
    expect(result.result.truncated).toBe(true);
    expect(result.result.output).toContain("No matches in the scanned workspace files");
  });

  test("says so rather than returning nothing for a blank pattern", async () => {
    const workspace = await workspaceWithToolkits();
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "   " }, "call_find_blank");
    expect(result.result.output).toBe("No matches.");
    expect(result.result.matches).toBe(0);
  });

  test("ranks an exact path above the same name nested deeper", async () => {
    const workspace = dirs.createDir("acolyte-find-rank-");
    await mkdir(join(workspace, "sub"), { recursive: true });
    await writeFile(join(workspace, "package.json"), "{}\n", "utf8");
    await writeFile(join(workspace, "sub", "package.json"), "{}\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "package.json" }, "call_find_rank");
    expect(result.result.paths[0]).toBe("./package.json");
  });

  test("reports an uncapped result as complete", async () => {
    const workspace = await workspaceWithToolkits();
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.findFiles.execute({ pattern: "src/*-toolkit.ts" }, "call_find_untruncated");
    expect(result.result.matches).toBe(2);
    expect(result.result.truncated).toBe(false);
    expect(result.result.output).not.toContain("Narrow the pattern");
  });
});

describe("createFile", () => {
  test("creates workspace files", async () => {
    const workspace = dirs.createDir("acolyte-create-ws-");
    const filePath = join(workspace, `test-write-${testUuid()}.txt`);
    const { tools, session } = toolsForAgent({ workspace });
    const result = await tools.createFile.execute({ path: filePath, content: "hello" }, "call_create_ws");
    expect(result.result.output).toContain("bytes=5");
    expect(session.callLog[0]?.toolName).toBe("file-create");
  });
});

describe("deleteFile", () => {
  test("deletes workspace files", async () => {
    const workspace = dirs.createDir("acolyte-delete-ws-");
    const filePath = join(workspace, `test-delete-${testUuid()}.txt`);
    await writeFile(filePath, "alpha\nbeta\n", "utf8");
    const { tools, session } = toolsForAgent({ workspace });
    const result = await tools.deleteFile.execute({ path: filePath }, "call_delete_ws");
    expect(result.result.output).toContain("bytes=");
    expect(session.callLog[0]?.toolName).toBe("file-delete");
    const { tools: tools2 } = toolsForAgent({ workspace });
    await expect(tools2.readFile.execute({ path: filePath }, "call_delete_verify")).rejects.toThrow();
  });
});
