import { readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { type GitignoreContext, isIgnoredByPatterns, loadGitignoreContext } from "./gitignore";

const DIFF_CONTEXT_RADIUS = 2;

const TEMP_ROOTS = Array.from(new Set([resolve(tmpdir()), resolve("/tmp"), resolve("/private/tmp")]));
const GIT_ENV_KEYS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_WORK_TREE",
] as const;

function resolveAgentPath(pathInput: string, workspace: string): string {
  return resolve(workspace, pathInput);
}

function isWithinWorkspace(pathInput: string, workspace: string): boolean {
  const absPath = resolveAgentPath(pathInput, workspace);
  return absPath === workspace || absPath.startsWith(`${workspace}/`);
}

function isWithinTempRoot(pathInput: string, workspace: string): boolean {
  const absPath = resolveAgentPath(pathInput, workspace);
  return TEMP_ROOTS.some((root) => absPath === root || absPath.startsWith(`${root}/`));
}

export function isAllowedPath(pathInput: string, workspace: string): boolean {
  return isWithinWorkspace(pathInput, workspace) || isWithinTempRoot(pathInput, workspace);
}

export function ensurePathWithinAllowedRoots(pathInput: string, operation: string, workspace: string): string {
  const absPath = resolveAgentPath(pathInput, workspace);
  if (!isAllowedPath(absPath, workspace)) throw new Error(`${operation} is restricted to the workspace or /tmp`);
  return absPath;
}

export async function runCommand(
  cmd: string[],
  workspace: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS) delete env[key];
  const proc = Bun.spawn({
    cmd,
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [stdoutText, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return {
    code: exitCode,
    stdout: stdoutText,
    stderr: stderrText,
  };
}

// Directories always excluded regardless of .gitignore — these are either internal
// runtime directories or universally irrelevant to any project's source.
export const IGNORED_DIRS = new Set(["node_modules", ".git", ".acolyte"]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".zip",
  ".gz",
  ".tar",
  ".bz2",
  ".7z",
  ".rar",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".class",
  ".jar",
  ".war",
  ".pyc",
  ".pyo",
  ".wasm",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".avi",
  ".mov",
  ".mkv",
  ".flv",
  ".webm",
  ".db",
  ".sqlite",
  ".sqlite3",
]);

export function isBinaryExtension(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

export async function collectWorkspaceFiles(workspace: string, maxEntries = 5000): Promise<string[]> {
  const out: string[] = [];
  const rootContext = await loadGitignoreContext(workspace);
  const rootContexts: GitignoreContext[] = rootContext ? [rootContext] : [];
  const stack: Array<{ abs: string; rel: string; contexts: GitignoreContext[] }> = [
    { abs: workspace, rel: "", contexts: rootContexts },
  ];

  while (stack.length > 0 && out.length < maxEntries) {
    const current = stack.pop();
    if (!current) break;
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await readdir(current.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      const abs = join(current.abs, entry.name);
      const isDir = entry.isDirectory();
      if (isIgnoredByPatterns(current.contexts, abs, isDir)) continue;
      if (isDir) {
        const childContext = await loadGitignoreContext(abs);
        const childContexts = childContext ? [...current.contexts, childContext] : current.contexts;
        stack.push({ abs, rel, contexts: childContexts });
      } else if (entry.isFile()) {
        out.push(rel);
      }
      if (out.length >= maxEntries) break;
    }
  }

  return out;
}

function normalizeRelPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
}

function isWithinWorkspacePath(absPath: string, workspace: string): boolean {
  return absPath === workspace || absPath.startsWith(`${workspace}/`);
}

export async function resolveSearchScopeFiles(workspace: string, paths: string[] | undefined): Promise<string[]> {
  const allFiles = await collectWorkspaceFiles(workspace);
  const normalizedPaths = (paths ?? []).map((path) => path.trim()).filter((path) => path.length > 0);
  if (normalizedPaths.length === 0) return allFiles;
  const include = new Set<string>();
  for (const rawPath of normalizedPaths) {
    const absPath = ensurePathWithinAllowedRoots(rawPath, "Search", workspace);
    if (!isWithinWorkspacePath(absPath, workspace)) throw new Error("Search paths must be within the workspace");
    let entryStat: Awaited<ReturnType<typeof stat>>;
    try {
      entryStat = await stat(absPath);
    } catch {
      continue;
    }
    const relPath = normalizeRelPath(relative(workspace, absPath));
    if (entryStat.isFile()) {
      if (relPath.length > 0) include.add(relPath);
      continue;
    }
    if (!entryStat.isDirectory()) continue;
    if (relPath.length === 0) {
      for (const file of allFiles) include.add(file);
      continue;
    }
    const prefix = `${relPath}/`;
    for (const file of allFiles) {
      if (file === relPath || file.startsWith(prefix)) include.add(file);
    }
  }
  return Array.from(include);
}

export function displayPathForDiff(absPath: string, workspace: string): string {
  if (absPath === workspace) return ".";
  if (absPath.startsWith(`${workspace}/`)) return absPath.slice(workspace.length + 1);
  return absPath;
}

function contentLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function createDiff(path: string, previous: string | null, next: string): string {
  if (previous == null) {
    // New file: show all lines as additions.
    const newLines = contentLines(next);
    const header = [
      `diff --git a/${path} b/${path}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${path}`,
      `@@ -0,0 +1,${newLines.length} @@`,
    ];
    const added = newLines.map((line) => `+${line}`);
    return [...header, ...added].join("\n");
  }
  // For edits, use a minimal diff algorithm to produce proper hunks.
  const oldLines = contentLines(previous);
  const newLines = contentLines(next);
  return minimalUnifiedDiff(path, oldLines, newLines);
}

function minimalUnifiedDiff(path: string, oldLines: string[], newLines: string[]): string {
  // Myers-like LCS to find matching lines, then produce unified diff hunks.
  const n = oldLines.length;
  const m = newLines.length;
  // For large files, fall back to simple full-replacement diff.
  if (n + m > 10_000) {
    const header = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, `@@ -1,${n} +1,${m} @@`];
    return [...header, ...oldLines.map((l) => `-${l}`), ...newLines.map((l) => `+${l}`)].join("\n");
  }
  // Hunt–McIlroy style: build a map of new-line positions, then find LCS.
  const newLineMap = new Map<string, number[]>();
  for (let j = 0; j < m; j++) {
    const key = newLines[j];
    let arr = newLineMap.get(key);
    if (!arr) {
      arr = [];
      newLineMap.set(key, arr);
    }
    arr.push(j);
  }
  // Patience-like: find longest increasing subsequence of matched pairs.
  const matches: Array<{ oldIdx: number; newIdx: number }> = [];
  const used = new Uint8Array(m);
  for (let i = 0; i < n; i++) {
    const positions = newLineMap.get(oldLines[i]);
    if (!positions) continue;
    for (const j of positions) {
      if (used[j]) continue;
      // Greedy: accept first unused match that maintains order.
      if (matches.length === 0 || j > matches[matches.length - 1].newIdx) {
        matches.push({ oldIdx: i, newIdx: j });
        used[j] = 1;
        break;
      }
    }
  }
  // Build diff lines from matches.
  const diffLines: string[] = [];
  let oi = 0;
  let ni = 0;
  for (const match of matches) {
    while (oi < match.oldIdx) {
      diffLines.push(`-${oldLines[oi++]}`);
    }
    while (ni < match.newIdx) {
      diffLines.push(`+${newLines[ni++]}`);
    }
    diffLines.push(` ${oldLines[oi]}`);
    oi++;
    ni++;
  }
  while (oi < n) diffLines.push(`-${oldLines[oi++]}`);
  while (ni < m) diffLines.push(`+${newLines[ni++]}`);

  const isChange = diffLines.map((l) => !l.startsWith(" "));
  const hunkRanges: Array<{ start: number; end: number }> = [];
  let hunkStart = -1;
  for (let i = 0; i < diffLines.length; i++) {
    if (isChange[i]) {
      if (hunkStart === -1) hunkStart = Math.max(0, i - DIFF_CONTEXT_RADIUS);
      const hunkEnd = Math.min(diffLines.length, i + DIFF_CONTEXT_RADIUS + 1);
      if (hunkRanges.length > 0 && hunkStart <= hunkRanges[hunkRanges.length - 1].end) {
        hunkRanges[hunkRanges.length - 1].end = hunkEnd;
      } else {
        hunkRanges.push({ start: hunkStart, end: hunkEnd });
      }
      hunkStart = -1;
    }
  }

  const output = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  for (const range of hunkRanges) {
    let oldStart = 1;
    let newStart = 1;
    // Count line positions up to range.start
    for (let i = 0; i < range.start; i++) {
      if (diffLines[i].startsWith("-")) oldStart++;
      else if (diffLines[i].startsWith("+")) newStart++;
      else {
        oldStart++;
        newStart++;
      }
    }
    let oldCount = 0;
    let newCount = 0;
    for (let i = range.start; i < range.end; i++) {
      if (diffLines[i].startsWith("-")) oldCount++;
      else if (diffLines[i].startsWith("+")) newCount++;
      else {
        oldCount++;
        newCount++;
      }
    }
    output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (let i = range.start; i < range.end; i++) {
      output.push(diffLines[i]);
    }
  }
  return output.join("\n");
}

export function createUnifiedDeleteDiff(path: string, previous: string): string {
  const oldLines = contentLines(previous);
  const oldCount = oldLines.length;
  const header = [
    `diff --git a/${path} b/${path}`,
    "deleted file mode 100644",
    `--- a/${path}`,
    "+++ /dev/null",
    `@@ -1,${oldCount} +0,0 @@`,
  ];
  const removed = oldLines.map((line) => `-${line}`);
  return [...header, ...removed].join("\n");
}

export function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
}
