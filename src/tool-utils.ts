import { readdir, realpath, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { type GitignoreContext, isIgnoredByPatterns, loadGitignoreContext } from "./gitignore";
import { ensurePathWithinSandbox, resolveWorkspaceRoot } from "./workspace-sandbox";

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

// Inherited git state overrides an explicit cwd, so a subprocess would read whichever
// repository the ambient GIT_DIR names instead of the workspace it was handed.
export function envWithoutGitState(overrides?: Record<string, string>): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  for (const key of GIT_ENV_KEYS) delete env[key];
  if (overrides) Object.assign(env, overrides);
  return env;
}

export async function runCommand(
  cmd: string[],
  workspace: string,
  envOverride?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = envWithoutGitState(envOverride);
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

export type WorkspaceFiles = { files: string[]; truncated: boolean };

export async function collectWorkspaceFiles(workspace: string, maxEntries = 5000): Promise<WorkspaceFiles> {
  const out: string[] = [];
  const rootContext = await loadGitignoreContext(workspace);
  const rootContexts: GitignoreContext[] = rootContext ? [rootContext] : [];
  const stack: Array<{ abs: string; rel: string; contexts: GitignoreContext[] }> = [
    { abs: workspace, rel: "", contexts: rootContexts },
  ];

  while (stack.length > 0) {
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
        if (out.length >= maxEntries) return { files: out, truncated: true };
        out.push(rel);
      }
    }
  }

  return { files: out, truncated: false };
}

function normalizeRelPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
}

export async function resolveSearchScopeFiles(workspace: string, paths: string[] | undefined): Promise<string[]> {
  const { files: allFiles } = await collectWorkspaceFiles(workspace);
  const workspaceRoot = resolveWorkspaceRoot(workspace);
  const normalizedPaths = (paths ?? []).map((path) => path.trim()).filter((path) => path.length > 0);
  if (normalizedPaths.length === 0) return allFiles;
  const include = new Set<string>();
  for (const rawPath of normalizedPaths) {
    const absPath = ensurePathWithinSandbox(rawPath, workspace);
    let entryStat: Awaited<ReturnType<typeof stat>>;
    try {
      entryStat = await stat(absPath);
    } catch {
      continue;
    }
    const canonicalPath = await realpath(absPath);
    const relPath = normalizeRelPath(relative(workspaceRoot, canonicalPath));
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
