import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFileContext } from "./file-context";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildFileContext", () => {
  test("attaches regular files", async () => {
    const root = makeTempDir("acolyte-file-context-file-");
    const file = join(root, "demo.ts");
    writeFileSync(file, "const x = 1;\n", "utf8");
    const context = await buildFileContext(file);
    expect(context).toContain("Attached file: demo.ts");
    expect(context).toContain("const x = 1;");
  });

  test("attaches directories as tree listing", async () => {
    const root = makeTempDir("acolyte-file-context-dir-");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export {};\n", "utf8");
    writeFileSync(join(root, "README.md"), "# Demo\n", "utf8");
    const context = await buildFileContext(root);
    expect(context).toContain("Attached directory:");
    expect(context).toContain("src/");
    expect(context).toContain("src/index.ts");
    expect(context).toContain("README.md");
  });
});
