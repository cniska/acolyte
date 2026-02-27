import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFileContext } from "./file-context";
import { tempDirFactory } from "./test-factory";

const { createTempDir, cleanup } = tempDirFactory();
afterEach(cleanup);

describe("buildFileContext", () => {
  test("attaches regular files", async () => {
    const root = createTempDir("acolyte-file-context-file-");
    const file = join(root, "demo.ts");
    writeFileSync(file, "const x = 1;\n", "utf8");
    const context = await buildFileContext(file);
    expect(context).toContain("Attached file: demo.ts");
    expect(context).toContain("const x = 1;");
  });

  test("attaches directories as tree listing", async () => {
    const root = createTempDir("acolyte-file-context-dir-");
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
