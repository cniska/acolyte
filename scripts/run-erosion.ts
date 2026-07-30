import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  analyzeSource,
  computeErosion,
  type ErosionReport,
  type FunctionMetric,
  HIGH_COMPLEXITY_THRESHOLD,
} from "./erosion-metrics";

type ErosionArgs = {
  paths: string[];
  includeTests: boolean;
  json: boolean;
  top: number;
  tags: boolean;
  limit: number | null;
};

type TagReport = { tag: string; report: ErosionReport };

const REPO_DIR = join(import.meta.dir, "..");
const DEFAULT_PATHS = ["src"];
const DEFAULT_TOP = 10;
const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "build"]);

export function parseErosionArgs(argv: string[]): ErosionArgs {
  const paths: string[] = [];
  let includeTests = false;
  let json = false;
  let top = DEFAULT_TOP;
  let tags = false;
  let limit: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--include-tests") includeTests = true;
    else if (arg === "--json") json = true;
    else if (arg === "--tags") tags = true;
    else if (arg === "--top") top = Number(argv[++i]);
    else if (arg === "--limit") limit = Number(argv[++i]);
    else if (arg.startsWith("--")) throw new Error(`unknown flag: ${arg}`);
    else paths.push(arg);
  }

  if (!Number.isFinite(top) || top < 0) throw new Error("--top requires a non-negative number");
  if (limit !== null && (!Number.isFinite(limit) || limit < 1)) throw new Error("--limit requires a positive number");

  return { paths: paths.length > 0 ? paths : DEFAULT_PATHS, includeTests, json, top, tags, limit };
}

export function isSourceFile(file: string, includeTests: boolean): boolean {
  if (!(file.endsWith(".ts") || file.endsWith(".tsx"))) return false;
  if (file.endsWith(".d.ts")) return false;
  if (includeTests) return true;
  return !(file.endsWith(".test.ts") || file.endsWith(".test.tsx") || file.endsWith(".int.test.ts"));
}

function collectFiles(root: string, includeTests: boolean): string[] {
  const stats = statSync(root, { throwIfNoEntry: false });
  if (!stats) throw new Error(`no such path: ${root}`);
  if (stats.isFile()) return isSourceFile(root, includeTests) ? [root] : [];

  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) found.push(...collectFiles(path, includeTests));
      continue;
    }
    if (isSourceFile(path, includeTests)) found.push(path);
  }
  return found;
}

function measure(
  baseDir: string,
  paths: string[],
  includeTests: boolean,
): { metrics: FunctionMetric[]; files: number } {
  const metrics: FunctionMetric[] = [];
  let files = 0;
  for (const path of paths) {
    const root = resolve(baseDir, path);
    const displayBase = root === baseDir ? root : dirname(root);
    for (const file of collectFiles(root, includeTests)) {
      files += 1;
      metrics.push(...analyzeSource(relative(displayBase, file), readFileSync(file, "utf8")));
    }
  }
  return { metrics, files };
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_DIR, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function releaseTags(limit: number | null): string[] {
  const tags = git(["tag", "--sort=v:refname"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => tag.startsWith("v"));
  return limit === null ? tags : tags.slice(-limit);
}

// A tag predating every measured path has nothing to archive, so it is reported as skipped
// rather than aborting the curve for the tags that do have it.
function measureTag(tag: string, paths: string[], includeTests: boolean): ErosionReport | null {
  const workDir = mkdtempSync(join(tmpdir(), "acolyte-erosion-"));
  const archive = join(workDir, "tree.tar");
  try {
    writeFileSync(
      archive,
      execFileSync("git", ["archive", tag, "--", ...paths], { cwd: REPO_DIR, maxBuffer: 256 * 1024 * 1024 }),
    );
    execFileSync("tar", ["-x", "-f", archive, "-C", workDir]);
    const { metrics, files } = measure(workDir, paths, includeTests);
    return computeErosion(metrics, files);
  } catch {
    return null;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printReport(report: ErosionReport, metrics: FunctionMetric[], top: number): void {
  console.log(
    `erosion   ${formatPercent(report.erosion)}  (CC > ${HIGH_COMPLEXITY_THRESHOLD} share of complexity mass)`,
  );
  console.log(`files     ${report.files}`);
  console.log(`functions ${report.functions} (${report.highFunctions} high-complexity)`);
  console.log(`sloc      ${report.sloc}`);
  if (top === 0) return;

  const heaviest = [...metrics].sort((a, b) => b.mass - a.mass).slice(0, top);
  if (heaviest.length === 0) return;
  console.log(`\ntop ${heaviest.length} by mass (cc x sqrt(sloc)):`);
  const width = Math.max(...heaviest.map((metric) => metric.name.length));
  for (const metric of heaviest) {
    const location = `${metric.file}:${metric.line}`;
    console.log(
      `  ${metric.name.padEnd(width)}  cc ${String(metric.cyclomatic).padStart(3)}  sloc ${String(metric.sloc).padStart(4)}  mass ${metric.mass.toFixed(1).padStart(6)}  ${location}`,
    );
  }
}

function printCurve(reports: TagReport[]): void {
  console.log("tag       erosion  functions  high  sloc");
  for (const { tag, report } of reports) {
    console.log(
      `${tag.padEnd(9)} ${formatPercent(report.erosion).padStart(6)}  ${String(report.functions).padStart(9)}  ${String(report.highFunctions).padStart(4)}  ${String(report.sloc).padStart(5)}`,
    );
  }
}

export async function runErosion(argv: string[]): Promise<void> {
  const args = parseErosionArgs(argv);

  if (args.tags) {
    const measured = releaseTags(args.limit).map((tag) => ({
      tag,
      report: measureTag(tag, args.paths, args.includeTests),
    }));
    const reports: TagReport[] = [];
    const skipped: string[] = [];
    for (const entry of measured) {
      if (entry.report === null) skipped.push(entry.tag);
      else reports.push({ tag: entry.tag, report: entry.report });
    }
    if (args.json) console.log(JSON.stringify({ reports, skipped }, null, 2));
    else printCurve(reports);
    if (skipped.length > 0) console.log(`\nskipped (path absent at tag): ${skipped.join(", ")}`);
    return;
  }

  const { metrics, files } = measure(REPO_DIR, args.paths, args.includeTests);
  const report = computeErosion(metrics, files);
  if (args.json) {
    console.log(JSON.stringify({ report, functions: metrics }, null, 2));
    return;
  }
  printReport(report, metrics, args.top);
}

if (import.meta.main) {
  try {
    await runErosion(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
