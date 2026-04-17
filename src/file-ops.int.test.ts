import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TOOL_ERROR_CODES } from "./error-contract";
import { readFileContent, readFileContents } from "./file-ops";
import { tempDir, testUuid } from "./test-utils";
import { toolsForAgent } from "./tool-registry";

const dirs = tempDir();
afterEach(dirs.cleanupDirs);

describe("path validation — fs", () => {
  test("readFile allows workspace files", async () => {
    const workspace = dirs.createDir("acolyte-read-ws-");
    const filePath = join(workspace, `test-read-${testUuid()}.txt`);
    await writeFile(filePath, "hello from workspace", "utf8");
    const { tools } = toolsForAgent({ workspace });
    const result = await tools.readFile.execute({ paths: [{ path: filePath }] }, "call_read_ws");
    expect(result.result.output).toContain("hello from workspace");
  });

  test("readFileContent rejects files exceeding maxLines", async () => {
    const workspace = dirs.createDir("acolyte-read-maxlines-");
    const filePath = join(workspace, `test-large-${testUuid()}.txt`);
    const lines = Array.from({ length: 11 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(filePath, lines, "utf8");
    await expect(readFileContent(workspace, filePath, 10)).rejects.toThrow(/too large/);
  });

  test("readFileContent allows files at exactly maxLines", async () => {
    const workspace = dirs.createDir("acolyte-read-exact-");
    const filePath = join(workspace, `test-exact-${testUuid()}.txt`);
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(filePath, lines, "utf8");
    const output = await readFileContent(workspace, filePath, 10);
    expect(output).toContain("line 1");
  });

  test("readFileContents returns partial results when one file exceeds maxLines", async () => {
    const workspace = dirs.createDir("acolyte-read-batch-");
    const small = join(workspace, `test-small-${testUuid()}.txt`);
    const large = join(workspace, `test-large-${testUuid()}.txt`);
    await writeFile(small, "ok", "utf8");
    await writeFile(large, Array.from({ length: 11 }, (_, i) => `line ${i + 1}`).join("\n"), "utf8");
    const output = await readFileContents(workspace, [small, large], 10);
    expect(output).toContain("ok");
    expect(output).toContain("too large");
    expect(output).toContain(large);
  });

  test("readFileContents returns partial results when a file is missing", async () => {
    const workspace = dirs.createDir("acolyte-read-missing-");
    const real = join(workspace, `test-real-${testUuid()}.txt`);
    const missing = join(workspace, `test-missing-${testUuid()}.txt`);
    await writeFile(real, "hello", "utf8");
    const output = await readFileContents(workspace, [real, missing]);
    expect(output).toContain("hello");
    expect(output).toContain(missing);
    expect(output).toContain("Error:");
  });

  test("readFileContents throws when all files fail", async () => {
    const workspace = dirs.createDir("acolyte-read-allfail-");
    const missing1 = join(workspace, `missing-1-${testUuid()}.txt`);
    const missing2 = join(workspace, `missing-2-${testUuid()}.txt`);
    await expect(readFileContents(workspace, [missing1, missing2])).rejects.toThrow();
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
});

describe("searchFiles", () => {
  test("rejects when a scoped file has no matches", async () => {
    const workspace = dirs.createDir("acolyte-search-nomatch-");
    const filePath = join(workspace, `tmp-search-no-match-${testUuid()}.txt`);
    await writeFile(filePath, "alpha beta\n", "utf8");
    const { tools } = toolsForAgent({ workspace });
    await expect(
      tools.searchFiles.execute({ patterns: ["gamma"], paths: [filePath] }, "call_search_nomatch"),
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
    const result = await tools.searchFiles.execute(
      { patterns: ["needle"], paths: [first] },
      "call_search_scope",
    );
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
      { patterns: ["needle"], paths: [join(workspace, "sub")] },
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
    const result = await tools.searchFiles.execute(
      { patterns: ["needle"], paths: [filePath] },
      "call_search_symlink",
    );
    expect(result.result.output).toContain("inside.ts:1:");
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
    const result = await tools.deleteFile.execute({ paths: [filePath] }, "call_delete_ws");
    expect(result.result.output).toContain("bytes=");
    expect(session.callLog[0]?.toolName).toBe("file-delete");
    const { tools: tools2 } = toolsForAgent({ workspace });
    await expect(tools2.readFile.execute({ paths: [{ path: filePath }] }, "call_delete_verify")).rejects.toThrow();
  });
});
