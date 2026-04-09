import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ERROR_KINDS, TOOL_ERROR_CODES } from "./error-contract";
import { expectToThrowJSON, tempDir } from "./test-utils";
import { clearWorkspaceSandboxCache, ensurePathWithinSandbox, isWithinSandboxRoot } from "./workspace-sandbox";

const dirs = tempDir();

afterAll(() => {
  clearWorkspaceSandboxCache();
  dirs.cleanupDirs();
});

describe("workspace-sandbox", () => {
  test("allows existing and new paths inside the workspace sandbox", async () => {
    const root = dirs.createDir("acolyte-sandbox-");
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const existing = join(workspace, "a.txt");
    await writeFile(existing, "ok\n", "utf8");

    const existingResult = ensurePathWithinSandbox(existing, workspace);
    const newResult = ensurePathWithinSandbox("nested/new.txt", workspace);

    expect(existingResult).toBe(existing);
    expect(newResult).toBe(join(workspace, "nested", "new.txt"));
  });

  test("blocks paths outside the workspace sandbox", async () => {
    const root = dirs.createDir("acolyte-sandbox-outside-");
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });

    expect(() => ensurePathWithinSandbox("/etc/hosts", workspace)).toThrow("Sandbox violation");
    expectToThrowJSON(() => ensurePathWithinSandbox("/etc/hosts", workspace)).toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("blocks symlink escapes for existing targets", async () => {
    const root = dirs.createDir("acolyte-sandbox-symlink-");
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });

    const outsideFile = join(outside, "secret.txt");
    await writeFile(outsideFile, "secret\n", "utf8");
    await symlink(outsideFile, join(workspace, "secret-link.txt"));

    expectToThrowJSON(() => ensurePathWithinSandbox("secret-link.txt", workspace)).toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("resolves through a symlinked workspace root", async () => {
    const root = dirs.createDir("acolyte-sandbox-symlink-root-");
    const realWorkspace = join(root, "real");
    const linkedWorkspace = join(root, "linked");
    await mkdir(realWorkspace, { recursive: true });
    await symlink(realWorkspace, linkedWorkspace);

    const file = join(realWorkspace, "a.txt");
    await writeFile(file, "ok\n", "utf8");

    // Files accessible through the symlinked root are allowed
    expect(ensurePathWithinSandbox("a.txt", linkedWorkspace)).toBe(join(linkedWorkspace, "a.txt"));

    // Paths outside both the real and linked root are still blocked
    expectToThrowJSON(() => ensurePathWithinSandbox("/etc/hosts", linkedWorkspace)).toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("blocks symlink escapes for new files under symlinked directories", async () => {
    const root = dirs.createDir("acolyte-sandbox-parent-");
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });

    await symlink(outside, join(workspace, "out"));

    expectToThrowJSON(() => ensurePathWithinSandbox("out/new-file.txt", workspace)).toMatchObject({
      code: TOOL_ERROR_CODES.sandboxViolation,
      kind: ERROR_KINDS.sandboxViolation,
    });
  });

  test("isWithinSandboxRoot rejects traversal", () => {
    expect(isWithinSandboxRoot("/etc/passwd", "/workspace/project")).toBe(false);
    expect(isWithinSandboxRoot("/workspace/other", "/workspace/project")).toBe(false);
  });

  test("isWithinSandboxRoot allows paths within root", () => {
    expect(isWithinSandboxRoot("/workspace/project/src/index.ts", "/workspace/project")).toBe(true);
    expect(isWithinSandboxRoot("/workspace/project", "/workspace/project")).toBe(true);
  });
});
