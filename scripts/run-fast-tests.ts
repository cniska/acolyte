import { readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOTS = ["src", "scripts"];
const TEST_RE = /\.test\.(ts|tsx)$/;
const INTEGRATION_TEST_RE = /\.int\.test\.(ts|tsx)$/;

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
    if (!TEST_RE.test(path)) continue;
    if (INTEGRATION_TEST_RE.test(path)) continue;
    out.push(path);
  }
  return out;
}

async function main(): Promise<void> {
  const extraArgs = process.argv.slice(2);
  const files = (await Promise.all(ROOTS.map((root) => collectFiles(root)))).flat().sort();
  if (files.length === 0) {
    console.error("No test files found");
    process.exit(1);
  }

  const proc = Bun.spawn(["bun", "test", ...files, ...extraArgs], {
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
