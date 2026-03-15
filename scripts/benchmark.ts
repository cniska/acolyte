import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKDIR = "/tmp/acolyte-benchmarks";
const MAX_FILE_LINES = 10_000;

type Lang = "typescript" | "python" | "rust" | "go";

interface Project {
  name: string;
  url: string;
  lang: Lang;
}

const PROJECTS: Project[] = [
  { name: "acolyte", url: "https://github.com/cniska/acolyte.git", lang: "typescript" },
  { name: "aider", url: "https://github.com/Aider-AI/aider.git", lang: "python" },
  { name: "opencode", url: "https://github.com/anomalyco/opencode.git", lang: "typescript" },
  { name: "pi", url: "https://github.com/badlogic/pi-mono.git", lang: "typescript" },
  { name: "goose", url: "https://github.com/block/goose.git", lang: "rust" },
  { name: "openhands", url: "https://github.com/All-Hands-AI/OpenHands.git", lang: "python" },
  { name: "continue", url: "https://github.com/continuedev/continue.git", lang: "typescript" },
  { name: "cline", url: "https://github.com/cline/cline.git", lang: "typescript" },
  { name: "openclaw", url: "https://github.com/openclaw/openclaw.git", lang: "typescript" },
  { name: "plandex", url: "https://github.com/plandex-ai/plandex.git", lang: "go" },
];

// --- file collection ---

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function pathExcluded(p: string, excludes: string[]): boolean {
  return excludes.some((ex) => p.includes(ex));
}

const TS_EXCLUDE_DIRS = ["/node_modules/", "/.git/", "/dist/", "/build/", "/generated/", "/scripts/"];
const TS_TEST_RE = /\.(test|spec|int\.test|tui\.test|perf\.test)\.(ts|tsx)$/;

function findSourceTs(dir: string): string[] {
  return walk(dir).filter(
    (f) => /\.(ts|tsx)$/.test(f) && !pathExcluded(f, TS_EXCLUDE_DIRS) && !f.endsWith(".d.ts") && !TS_TEST_RE.test(f),
  );
}

function findTestTs(dir: string): string[] {
  return walk(dir).filter((f) => TS_TEST_RE.test(f) && !pathExcluded(f, ["/node_modules/", "/.git/", "/dist/"]));
}

const PY_EXCLUDE_DIRS = ["/.git/", "/__pycache__/", "/migrations/", "/generated/"];

function findSourcePy(dir: string): string[] {
  return walk(dir).filter((f) => f.endsWith(".py") && !pathExcluded(f, PY_EXCLUDE_DIRS) && !f.includes("/test"));
}

function findTestPy(dir: string): string[] {
  return walk(dir).filter(
    (f) => f.endsWith(".py") && f.includes("/test") && !pathExcluded(f, ["/__pycache__/", "/.git/"]),
  );
}

const RS_EXCLUDE_DIRS = ["/.git/", "/target/"];

function findSourceRs(dir: string): string[] {
  return walk(dir).filter(
    (f) => f.endsWith(".rs") && !pathExcluded(f, RS_EXCLUDE_DIRS) && !f.includes("/tests/") && !f.endsWith("_test.rs"),
  );
}

function findTestRs(dir: string): string[] {
  return walk(dir).filter(
    (f) => f.endsWith(".rs") && !pathExcluded(f, RS_EXCLUDE_DIRS) && (f.includes("/tests/") || f.endsWith("_test.rs")),
  );
}

const GO_EXCLUDE_DIRS = ["/.git/", "/vendor/"];

function findSourceGo(dir: string): string[] {
  return walk(dir).filter((f) => f.endsWith(".go") && !pathExcluded(f, GO_EXCLUDE_DIRS) && !f.endsWith("_test.go"));
}

function findTestGo(dir: string): string[] {
  return walk(dir).filter((f) => f.endsWith("_test.go") && !pathExcluded(f, GO_EXCLUDE_DIRS));
}

// --- counting helpers ---

interface FileStats {
  files: string[];
  lines: string[];
  lineCount: number;
  fileCounts: { file: string; lines: number }[];
}

function readFiles(files: string[]): FileStats {
  const result: FileStats = { files: [], lines: [], lineCount: 0, fileCounts: [] };
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const fileLines = content.split("\n");
    if (fileLines.length > MAX_FILE_LINES) continue;
    result.files.push(file);
    result.lines.push(...fileLines);
    result.lineCount += fileLines.length;
    result.fileCounts.push({ file, lines: fileLines.length });
  }
  return result;
}

function countTestLines(files: string[]): { count: number; fileCount: number } {
  let count = 0;
  let fileCount = 0;
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    count += content.split("\n").length;
    fileCount++;
  }
  return { count, fileCount };
}

function countMatches(lines: string[], pattern: RegExp): number {
  let count = 0;
  for (const line of lines) {
    const matches = line.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

function per1k(count: number, total: number): string {
  if (total === 0) return "0.0";
  return ((count / total) * 1000).toFixed(1);
}

// --- dependency counting ---

function countDepsTs(dir: string): { runtime: number; dev: number } {
  const pkgFiles = walk(dir).filter(
    (f) => f.endsWith("/package.json") && !pathExcluded(f, ["/node_modules/", "/.git/"]),
  );
  const runtime = new Set<string>();
  const dev = new Set<string>();
  for (const f of pkgFiles) {
    try {
      const pkg = JSON.parse(readFileSync(f, "utf8"));
      for (const d of Object.keys(pkg.dependencies ?? {})) runtime.add(d);
      for (const d of Object.keys(pkg.devDependencies ?? {})) dev.add(d);
    } catch {}
  }
  return { runtime: runtime.size, dev: dev.size };
}

function countReqLines(file: string): number {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("-")).length;
}

function countTomlDeps(file: string, kind: "runtime" | "dev"): number {
  const text = readFileSync(file, "utf8");
  if (kind === "runtime") {
    // Match dependencies = [ ... ] where ] is on its own line
    const m = text.match(/^dependencies\s*=\s*\[(.*?)^\]/ms);
    if (!m) return 0;
    return m[1].split("\n").filter((l) => /^\s*"/.test(l)).length;
  }
  // Dev: try [dependency-groups] dev = [...] first, then [project.optional-dependencies]
  const dg = text.match(/\[dependency-groups\]\s*\ndev\s*=\s*\[(.*?)^\]/ms);
  if (dg) return dg[1].split("\n").filter((l) => /^\s*"/.test(l)).length;
  const od = text.match(/\[project\.optional-dependencies\](.*?)(\n\[|$)/s);
  if (od) return od[1].split("\n").filter((l) => /^\s*"/.test(l)).length;
  return 0;
}

function countDepsPython(dir: string): { runtime: number; dev: number } {
  let runtime = 0;
  let dev = 0;

  // Prefer .in files (direct deps) over .txt lockfiles
  const rtCandidates = [`${dir}/requirements/requirements.in`, `${dir}/requirements.in`];
  for (const f of rtCandidates) {
    if (existsSync(f)) {
      runtime = countReqLines(f);
      break;
    }
  }
  if (runtime === 0 && existsSync(`${dir}/pyproject.toml`)) {
    runtime = countTomlDeps(`${dir}/pyproject.toml`, "runtime");
  }
  if (runtime === 0 && existsSync(`${dir}/requirements.txt`)) {
    runtime = countReqLines(`${dir}/requirements.txt`);
  }

  const devCandidates = [
    `${dir}/requirements/requirements-dev.in`,
    `${dir}/requirements-dev.in`,
    `${dir}/requirements/requirements-dev.txt`,
    `${dir}/requirements-dev.txt`,
  ];
  for (const f of devCandidates) {
    if (existsSync(f)) {
      dev = countReqLines(f);
      break;
    }
  }
  if (dev === 0 && existsSync(`${dir}/pyproject.toml`)) {
    dev = countTomlDeps(`${dir}/pyproject.toml`, "dev");
  }

  return { runtime, dev };
}

function countDepsRust(dir: string): { runtime: number; dev: number } {
  const cargoFiles = walk(dir).filter((f) => f.endsWith("/Cargo.toml") && !f.includes("/target/"));
  const runtime = new Set<string>();
  const dev = new Set<string>();
  for (const f of cargoFiles) {
    const text = readFileSync(f, "utf8");
    let section = "";
    for (const line of text.split("\n")) {
      if (line.startsWith("[")) section = line;
      else if (section === "[dependencies]" && /^[a-z_-]/.test(line)) {
        runtime.add(line.split(/[\s=]/)[0]);
      } else if (section === "[dev-dependencies]" && /^[a-z_-]/.test(line)) {
        dev.add(line.split(/[\s=]/)[0]);
      }
    }
  }
  return { runtime: runtime.size, dev: dev.size };
}

function countDepsGo(dir: string): { runtime: number; dev: number } {
  const modFiles = walk(dir).filter((f) => f.endsWith("/go.mod") && !pathExcluded(f, GO_EXCLUDE_DIRS));
  if (modFiles.length === 0) return { runtime: 0, dev: 0 };
  const runtime = new Set<string>();
  for (const modFile of modFiles) {
    const text = readFileSync(modFile, "utf8");
    let inRequire = false;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "require (" || trimmed === "require(") {
        inRequire = true;
        continue;
      }
      if (inRequire && trimmed === ")") {
        inRequire = false;
        continue;
      }
      if (inRequire && trimmed && !trimmed.startsWith("//") && !trimmed.includes("// indirect")) {
        runtime.add(trimmed.split(/\s/)[0]);
      }
      if (!inRequire && trimmed.startsWith("require ") && !trimmed.includes("// indirect")) {
        const pkg = trimmed.replace(/^require\s+/, "").split(/\s/)[0];
        if (pkg !== "(") runtime.add(pkg);
      }
    }
  }
  return { runtime: runtime.size, dev: 0 };
}

// --- git helpers ---

function cloneOrUpdate(name: string, url: string): void {
  const dir = join(WORKDIR, name);
  if (existsSync(join(dir, ".git"))) {
    console.log(`  Updating ${name}...`);
    try {
      execSync(`git -C ${dir} pull --ff-only --quiet`, { stdio: "ignore" });
    } catch {}
  } else {
    console.log(`  Cloning ${name}...`);
    execSync(`git clone --depth 1 --quiet ${url} ${dir}`, { stdio: "ignore" });
  }
}

function getCreatedDate(repoPath: string): string {
  try {
    const out = execSync(`gh api repos/${repoPath} --jq '.created_at'`, { encoding: "utf8" }).trim();
    return out.split("T")[0];
  } catch {
    return "unknown";
  }
}

// --- main ---

execSync(`mkdir -p ${WORKDIR}`);

console.log("=== Cloning / updating repos ===");
for (const p of PROJECTS) cloneOrUpdate(p.name, p.url);

console.log("\n=== Extracting metrics ===\n");

for (const p of PROJECTS) {
  const dir = join(WORKDIR, p.name);
  console.log(`--- ${p.name} (${p.lang}) ---`);

  // Find source and test files
  let sourceRaw: string[];
  let testRaw: string[];
  switch (p.lang) {
    case "typescript":
      sourceRaw = findSourceTs(dir);
      testRaw = findTestTs(dir);
      break;
    case "python":
      sourceRaw = findSourcePy(dir);
      testRaw = findTestPy(dir);
      break;
    case "rust":
      sourceRaw = findSourceRs(dir);
      testRaw = findTestRs(dir);
      break;
    case "go":
      sourceRaw = findSourceGo(dir);
      testRaw = findTestGo(dir);
      break;
  }

  const src = readFiles(sourceRaw);
  const test = countTestLines(testRaw);

  // Dependencies
  let deps: { runtime: number; dev: number };
  switch (p.lang) {
    case "typescript":
      deps = countDepsTs(dir);
      break;
    case "python":
      deps = countDepsPython(dir);
      break;
    case "rust":
      deps = countDepsRust(dir);
      break;
    case "go":
      deps = countDepsGo(dir);
      break;
  }

  const testRatio = src.lineCount > 0 ? (test.count / src.lineCount).toFixed(2) : "0.00";
  const avgLines = src.files.length > 0 ? Math.round(src.lineCount / src.files.length) : 0;
  const filesOver500 = src.fileCounts.filter((f) => f.lines > 500).length;
  const filesOver500Pct = src.files.length > 0 ? Math.round((filesOver500 / src.files.length) * 100) : 0;
  const largestFile = src.fileCounts.reduce((max, f) => (f.lines > max.lines ? f : max), { file: "", lines: 0 });

  let barrelFiles = 0;
  if (p.lang === "typescript") barrelFiles = src.files.filter((f) => f.endsWith("/index.ts")).length;
  else if (p.lang === "python") barrelFiles = src.files.filter((f) => f.endsWith("/__init__.py")).length;
  else if (p.lang === "rust") barrelFiles = src.files.filter((f) => f.endsWith("/mod.rs")).length;
  else if (p.lang === "go") barrelFiles = src.files.filter((f) => f.endsWith("/doc.go")).length;

  const repoPath = p.url.replace("https://github.com/", "").replace(".git", "");
  const initialCommit = getCreatedDate(repoPath);

  console.log(`  Source lines:     ${src.lineCount}`);
  console.log(`  Source files:     ${src.files.length}`);
  console.log(`  Avg lines/file:   ${avgLines}`);
  console.log(`  Files > 500:      ${filesOver500} (${filesOver500Pct}%)`);
  console.log(`  Largest file:     ${largestFile.lines}`);
  console.log(`  Barrel files:     ${barrelFiles}`);
  console.log(`  Initial commit:   ${initialCommit}`);
  console.log(`  Dependencies:     ${deps.runtime} runtime + ${deps.dev} dev = ${deps.runtime + deps.dev} total`);
  console.log(`  Test files:       ${test.fileCount}`);
  console.log(`  Test lines:       ${test.count}`);
  console.log(`  Test/source:      ${testRatio}`);

  // Language-specific quality metrics
  if (p.lang === "typescript") {
    const asAny = countMatches(src.lines, /as any/g);
    const colonAny = countMatches(src.lines, /: any\b/g);
    const tsIgnore = countMatches(src.lines, /@ts-ignore|@ts-expect-error/g);
    const lintIgnore = countMatches(src.lines, /eslint-disable|biome-ignore/g);
    const unknown = countMatches(src.lines, /: unknown/g);
    const todo = countMatches(src.lines, /TODO|FIXME|HACK/g);
    const comments = src.lines.filter((l) => l.trimStart().startsWith("//")).length;
    const safeParse = countMatches(src.lines, /\.safeParse\(/g);
    const tryBlocks = countMatches(src.lines, /try \{/g);
    const catchCalls = countMatches(src.lines, /\.catch\(/g);

    console.log(`  as any /1k:       ${per1k(asAny, src.lineCount)}  (${asAny} total)`);
    console.log(`  : any /1k:        ${per1k(colonAny, src.lineCount)}  (${colonAny} total)`);
    console.log(`  @ts-ignore /1k:   ${per1k(tsIgnore, src.lineCount)}  (${tsIgnore} total)`);
    console.log(`  lint ignores /1k: ${per1k(lintIgnore, src.lineCount)}  (${lintIgnore} total)`);
    console.log(`  : unknown /1k:    ${per1k(unknown, src.lineCount)}  (${unknown} total)`);
    console.log(`  TODO|FIXME /1k:   ${per1k(todo, src.lineCount)}  (${todo} total)`);
    console.log(`  Comments /1k:     ${per1k(comments, src.lineCount)}  (${comments} total)`);
    console.log(`  .safeParse /1k:   ${per1k(safeParse, src.lineCount)}  (${safeParse} total)`);
    console.log(`  try {} /1k:       ${per1k(tryBlocks, src.lineCount)}  (${tryBlocks} total)`);
    console.log(`  .catch() /1k:     ${per1k(catchCalls, src.lineCount)}  (${catchCalls} total)`);
  } else if (p.lang === "python") {
    const typeIgnore = countMatches(src.lines, /type: ignore/g);
    const anyType = countMatches(src.lines, /Any/g);
    const castCalls = countMatches(src.lines, /cast\(/g);
    const todo = countMatches(src.lines, /TODO|FIXME|HACK/g);
    const comments = src.lines.filter((l) => l.trimStart().startsWith("#")).length;

    console.log(`  type: ignore /1k: ${per1k(typeIgnore, src.lineCount)}  (${typeIgnore} total)`);
    console.log(`  Any type /1k:     ${per1k(anyType, src.lineCount)}  (${anyType} total)`);
    console.log(`  cast() /1k:       ${per1k(castCalls, src.lineCount)}  (${castCalls} total)`);
    console.log(`  TODO|FIXME /1k:   ${per1k(todo, src.lineCount)}  (${todo} total)`);
    console.log(`  Comments /1k:     ${per1k(comments, src.lineCount)}  (${comments} total)`);
  } else if (p.lang === "rust") {
    const unsafeCount = countMatches(src.lines, /unsafe/g);
    const unwrap = countMatches(src.lines, /\.unwrap\(\)/g);
    const expectCalls = countMatches(src.lines, /\.expect\(/g);
    const todo = countMatches(src.lines, /TODO|FIXME|HACK/g);
    const comments = src.lines.filter((l) => l.trimStart().startsWith("//")).length;

    console.log(`  unsafe /1k:       ${per1k(unsafeCount, src.lineCount)}  (${unsafeCount} total)`);
    console.log(`  .unwrap() /1k:    ${per1k(unwrap, src.lineCount)}  (${unwrap} total)`);
    console.log(`  .expect() /1k:    ${per1k(expectCalls, src.lineCount)}  (${expectCalls} total)`);
    console.log(`  TODO|FIXME /1k:   ${per1k(todo, src.lineCount)}  (${todo} total)`);
    console.log(`  Comments /1k:     ${per1k(comments, src.lineCount)}  (${comments} total)`);
  } else if (p.lang === "go") {
    const anyInterface = countMatches(src.lines, /\bany\b|interface\{\}/g);
    const panicCalls = countMatches(src.lines, /\bpanic\(/g);
    const nolint = countMatches(src.lines, /\/\/nolint|\/\/ nolint/g);
    const todo = countMatches(src.lines, /TODO|FIXME|HACK/g);
    const comments = src.lines.filter((l) => l.trimStart().startsWith("//")).length;

    console.log(`  any/interface{} /1k: ${per1k(anyInterface, src.lineCount)}  (${anyInterface} total)`);
    console.log(`  panic() /1k:      ${per1k(panicCalls, src.lineCount)}  (${panicCalls} total)`);
    console.log(`  nolint /1k:       ${per1k(nolint, src.lineCount)}  (${nolint} total)`);
    console.log(`  TODO|FIXME /1k:   ${per1k(todo, src.lineCount)}  (${todo} total)`);
    console.log(`  Comments /1k:     ${per1k(comments, src.lineCount)}  (${comments} total)`);
  }

  console.log();
}

console.log(`Done. All repos at ${WORKDIR}`);
