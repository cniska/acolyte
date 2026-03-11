import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatFileContext } from "./file-context";
import { tempDir } from "./test-utils";

const { createDir, cleanupDirs } = tempDir();
afterEach(cleanupDirs);

describe("formatFileContext", () => {
  test("attaches regular files", async () => {
    const root = createDir("acolyte-file-context-file-");
    const file = join(root, "demo.ts");
    writeFileSync(file, "const x = 1;\n", "utf8");
    const context = await formatFileContext(file);
    expect(context).toContain("Attached file: demo.ts");
    expect(context).toContain("const x = 1;");
  });

  test("attaches directories as tree listing", async () => {
    const root = createDir("acolyte-file-context-dir-");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export {};\n", "utf8");
    writeFileSync(join(root, "README.md"), "# Demo\n", "utf8");
    const context = await formatFileContext(root);
    expect(context).toContain("Attached directory:");
    expect(context).toContain("src/");
    expect(context).toContain("src/index.ts");
    expect(context).toContain("README.md");
  });
});
