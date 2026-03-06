import { readdir } from "node:fs/promises";
import { join } from "node:path";

const SRC_DIR = "src";
const SOURCE_RE = /\.ts$/;
const TEST_RE = /\.(test|int\.test|tui\.test|perf\.test)\.ts$/;

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(path)));
    } else if (entry.isFile() && SOURCE_RE.test(path)) {
      out.push(path);
    }
  }
  return out;
}

function countMatches(lines: string[], pattern: RegExp): number {
  let count = 0;
  for (const line of lines) {
    const matches = line.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

async function main(): Promise<void> {
  const allFiles = await collectFiles(SRC_DIR);
  const sourceFiles = allFiles.filter((f) => !TEST_RE.test(f));
  const testFiles = allFiles.filter((f) => TEST_RE.test(f));

  let sourceLines = 0;
  let testLines = 0;
  const sourceLineCounts: { file: string; lines: number }[] = [];
  const allSourceLines: string[] = [];

  for (const file of sourceFiles) {
    const content = await Bun.file(file).text();
    const lines = content.split("\n");
    const count = lines.length;
    sourceLines += count;
    sourceLineCounts.push({ file, lines: count });
    allSourceLines.push(...lines);
  }

  for (const file of testFiles) {
    const content = await Bun.file(file).text();
    testLines += content.split("\n").length;
  }

  const k = sourceLines / 1000;
  const avgLinesPerFile = Math.round(sourceLines / sourceFiles.length);
  const filesOver500 = sourceLineCounts.filter((f) => f.lines > 500).length;
  const largestFile = sourceLineCounts.reduce((max, f) => (f.lines > max.lines ? f : max), { file: "", lines: 0 });

  const asAny = countMatches(allSourceLines, /as any/g);
  const colonAny = countMatches(allSourceLines, /: any\b/g);
  const nonNull = countMatches(allSourceLines, /\w!\.\w/g);
  const tsIgnore = countMatches(allSourceLines, /@ts-ignore|@ts-expect-error/g);
  const biomeIgnore = countMatches(allSourceLines, /biome-ignore/g);
  const unknown = countMatches(allSourceLines, /: unknown/g);
  const todoFixme = countMatches(allSourceLines, /TODO|FIXME|HACK/g);
  const commentLines = allSourceLines.filter((l) => l.trimStart().startsWith("//")).length;
  const safeParse = countMatches(allSourceLines, /\.safeParse\(/g);
  const tryBlocks = countMatches(allSourceLines, /try \{/g);
  const catchCalls = countMatches(allSourceLines, /\.catch\(/g);
  const barrelFiles = sourceFiles.filter((f) => f.endsWith("/index.ts")).length;

  const pkg = await Bun.file("package.json").json();
  const deps = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;

  const initialCommitRaw = Bun.spawnSync(["git", "log", "--reverse", "--format=%cs", "--diff-filter=A"]);
  const initialCommit = new TextDecoder().decode(initialCommitRaw.stdout).trim().split("\n")[0];

  console.log("## Acolyte Benchmark Metrics\n");

  console.log("### Overview");
  console.log(`  Source lines:     ${sourceLines.toLocaleString()}`);
  console.log(`  Source files:     ${sourceFiles.length}`);
  console.log(`  Dependencies:     ${deps}`);
  console.log(`  Test files:       ${testFiles.length}`);
  console.log(`  Test lines:       ${testLines.toLocaleString()}`);
  console.log(`  Test/source:      ${(testLines / sourceLines).toFixed(2)}`);
  console.log();

  console.log("### Type Safety (per 1k source lines)");
  console.log(`  as any:           ${(asAny / k).toFixed(2)}  (${asAny} total)`);
  console.log(`  : any:            ${(colonAny / k).toFixed(1)}  (${colonAny} total)`);
  console.log(`  Non-null !.:      ${(nonNull / k).toFixed(1)}  (${nonNull} total)`);
  console.log(`  @ts-ignore:       ${(tsIgnore / k).toFixed(1)}  (${tsIgnore} total)`);
  console.log(`  biome-ignore:     ${(biomeIgnore / k).toFixed(1)}  (${biomeIgnore} total)`);
  console.log(`  : unknown:        ${(unknown / k).toFixed(1)}  (${unknown} total)`);
  console.log();

  console.log("### Tech Debt (per 1k source lines)");
  console.log(`  TODO/FIXME/HACK:  ${(todoFixme / k).toFixed(1)}  (${todoFixme} total)`);
  console.log(`  Comment lines:    ${(commentLines / k).toFixed(1)}  (${commentLines} total)`);
  console.log();

  console.log("### Module Cohesion");
  console.log(`  Avg lines/file:   ${avgLinesPerFile}`);
  console.log(`  Files > 500:      ${filesOver500} (${Math.round((filesOver500 / sourceFiles.length) * 100)}%)`);
  console.log(`  Largest file:     ${largestFile.lines.toLocaleString()} (${largestFile.file})`);
  console.log(`  Barrel files:     ${barrelFiles}`);
  console.log(`  Initial commit:   ${initialCommit}`);
  console.log();

  console.log("### Error Handling (per 1k source lines)");
  console.log(`  .safeParse():     ${(safeParse / k).toFixed(1)}  (${safeParse} total)`);
  console.log(`  try { }:          ${(tryBlocks / k).toFixed(1)}  (${tryBlocks} total)`);
  console.log(`  .catch():         ${(catchCalls / k).toFixed(1)}  (${catchCalls} total)`);
}

if (import.meta.main) {
  await main();
}
