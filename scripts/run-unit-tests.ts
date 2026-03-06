import { readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOTS = ["src", "scripts"];
const UNIT_TEST_RE = /\.test\.(ts|tsx)$/;
const EXCLUDED_TEST_RE = /\.(int|tui)\.test\.(ts|tsx)$/;

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(path)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!UNIT_TEST_RE.test(path)) continue;
    if (EXCLUDED_TEST_RE.test(path)) continue;
    out.push(path);
  }
  return out;
}

async function main(): Promise<void> {
  const files = (await Promise.all(ROOTS.map((root) => collectFiles(root)))).flat().sort();
  if (files.length === 0) {
    console.error("No unit test files found");
    process.exit(1);
  }

  const proc = Bun.spawn(["bun", "test", ...files], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: process.env,
  });

  const exitCode = await proc.exited;
  process.exit(exitCode);
}

if (import.meta.main) {
  await main();
}
