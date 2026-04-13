import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { ERROR_KINDS, TOOL_ERROR_CODES } from "./error-contract";
import { deleteTextFile, editFile, findFiles, readFileContent, searchFiles, writeTextFile } from "./file-ops";

const WORKSPACE = resolve(process.cwd());

describe("path validation", () => {
  test("readFileContent blocks paths outside workspace", async () => {
    await expect(readFileContent(WORKSPACE, "/etc/hosts")).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("editFile blocks paths outside workspace", async () => {
    await expect(
      editFile({ workspace: WORKSPACE, path: "/etc/hosts", edits: [{ find: "a", replace: "b" }] }),
    ).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("writeTextFile blocks paths outside workspace", async () => {
    await expect(writeTextFile({ workspace: WORKSPACE, path: "/etc/acolyte.txt", content: "x" })).rejects.toMatchObject(
      {
        code: TOOL_ERROR_CODES.sandboxViolation,
        kind: ERROR_KINDS.sandboxViolation,
      },
    );
  });

  test("deleteTextFile blocks paths outside workspace", async () => {
    await expect(deleteTextFile({ workspace: WORKSPACE, path: "/etc/hosts" })).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });
});

describe("searchFiles", () => {
  test("rejects when scoped paths resolve to no files", async () => {
    await expect(searchFiles(WORKSPACE, ["alias"], 20, ["src/does-not-exist"])).rejects.toMatchObject({
      code: TOOL_ERROR_CODES.searchFilesEmptyScope,
    });
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
