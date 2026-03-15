import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "./test-utils";
import { collectWorkspaceFiles } from "./tool-utils";

const dirs = tempDir();

afterAll(() => dirs.cleanupDirs());

async function createWorkspace(files: Record<string, string>): Promise<string> {
  const root = dirs.createDir("acolyte-tool-utils-");
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(root, relPath);
    await mkdir(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

describe("collectWorkspaceFiles — gitignore integration", () => {
  test("respects .gitignore patterns", async () => {
    const root = await createWorkspace({
      ".gitignore": "dist/\n*.log\n",
      "src/index.ts": "",
      "dist/bundle.js": "",
      "error.log": "",
    });

    const files = await collectWorkspaceFiles(root);
    expect(files).toContain("src/index.ts");
    expect(files).not.toContain("dist/bundle.js");
    expect(files).not.toContain("error.log");
    expect(files).toContain(".gitignore");
  });

  test("respects nested .gitignore files", async () => {
    const root = await createWorkspace({
      "src/.gitignore": "*.generated.ts\n",
      "src/foo.ts": "",
      "src/foo.generated.ts": "",
      "lib/foo.generated.ts": "",
    });

    const files = await collectWorkspaceFiles(root);
    expect(files).toContain("src/foo.ts");
    expect(files).not.toContain("src/foo.generated.ts");
    expect(files).toContain("lib/foo.generated.ts");
  });

  test("traverses hidden directories not in IGNORED_DIRS", async () => {
    const root = await createWorkspace({
      ".github/workflows/ci.yml": "",
      "src/index.ts": "",
    });

    const files = await collectWorkspaceFiles(root);
    expect(files).toContain(".github/workflows/ci.yml");
    expect(files).toContain("src/index.ts");
  });

  test("always excludes .git and node_modules regardless of .gitignore", async () => {
    const root = await createWorkspace({
      "src/index.ts": "",
      "node_modules/pkg/index.js": "",
      ".git/config": "",
    });

    const files = await collectWorkspaceFiles(root);
    expect(files).toContain("src/index.ts");
    expect(files.some((f) => f.startsWith("node_modules/"))).toBe(false);
    expect(files.some((f) => f.startsWith(".git/"))).toBe(false);
  });
});
