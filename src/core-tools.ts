import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { appConfig } from "./app-config";
import { createToolError, encodeToolError, TOOL_ERROR_CODES } from "./tool-error-codes";

const TEMP_ROOTS = Array.from(new Set([resolve(tmpdir()), resolve("/tmp"), resolve("/private/tmp")]));

async function runCommand(cmd: string[], workspace: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd,
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
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

export function detectLineWidth(workspace: string): number | null {
  const root = workspace;
  try {
    // biome.json
    for (const name of ["biome.json", "biome.jsonc"]) {
      const path = join(root, name);
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        const width = raw?.formatter?.lineWidth;
        if (typeof width === "number" && width > 0) return width;
      }
    }
    // .editorconfig (simple parse for max_line_length)
    const editorconfig = join(root, ".editorconfig");
    if (existsSync(editorconfig)) {
      const text = readFileSync(editorconfig, "utf8");
      const match = text.match(/max_line_length\s*=\s*(\d+)/);
      if (match) return Number(match[1]);
    }
    // .prettierrc (JSON format)
    for (const name of [".prettierrc", ".prettierrc.json"]) {
      const path = join(root, name);
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        const width = raw?.printWidth;
        if (typeof width === "number" && width > 0) return width;
      }
    }
    // deno.json
    for (const name of ["deno.json", "deno.jsonc"]) {
      const path = join(root, name);
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        const width = raw?.fmt?.lineWidth;
        if (typeof width === "number" && width > 0) return width;
      }
    }
  } catch {
    // Detection failed — fall back to no limit.
  }
  return null;
}

const IGNORED_DIRS = new Set(["node_modules", ".git", ".acolyte", "dist", "build", ".next", "coverage"]);

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
  ".bin",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wav",
  ".flac",
  ".wasm",
  ".pyc",
  ".class",
  ".o",
  ".a",
  ".sqlite",
  ".db",
  ".lock",
]);

function isBinaryExtension(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

async function collectWorkspaceFiles(workspace: string, maxEntries = 5000): Promise<string[]> {
  const out: string[] = [];
  const stack: Array<{ abs: string; rel: string }> = [{ abs: workspace, rel: "" }];

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
      if (entry.name.startsWith(".") && entry.isDirectory()) continue;
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      const abs = join(current.abs, entry.name);
      if (entry.isDirectory()) {
        stack.push({ abs, rel });
      } else if (entry.isFile()) {
        out.push(rel);
      }
      if (out.length >= maxEntries) break;
    }
  }

  return out;
}

export async function findFiles(workspace: string, patterns: string[], maxResults = 40): Promise<string> {
  if (patterns.length === 0) throw new Error("At least one pattern is required");
  const allFiles = await collectWorkspaceFiles(workspace);
  const multi = patterns.length > 1;
  const sections: string[] = [];

  for (const pattern of patterns) {
    const trimmed = pattern.trim();
    if (!trimmed) continue;
    const needle = trimmed
      .replace(/^\.\/+/, "")
      .replace(/[*?]+/g, "")
      .toLowerCase();

    const ranked = allFiles
      .filter((path) => path.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const aScore = aLower === needle ? 0 : aLower.endsWith(`/${needle}`) ? 1 : 2;
        const bScore = bLower === needle ? 0 : bLower.endsWith(`/${needle}`) ? 1 : 2;
        if (aScore !== bScore) return aScore - bScore;
        return a.length - b.length;
      })
      .slice(0, maxResults)
      .map((path) => `./${path}`);

    if (multi) sections.push(`--- ${trimmed} ---`);
    sections.push(ranked.length > 0 ? ranked.join("\n") : "No matches.");
  }

  return sections.join("\n");
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

async function resolveSearchScopeFiles(workspace: string, paths: string[] | undefined): Promise<string[]> {
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

export async function searchFiles(
  workspace: string,
  patterns: string[],
  maxResults = 40,
  paths?: string[],
): Promise<string> {
  const normalized = patterns.map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0);
  if (normalized.length === 0) throw new Error("Search pattern cannot be empty");
  const allFiles = await resolveSearchScopeFiles(workspace, paths);
  const matches: string[] = [];
  const regexes = normalized.map((pattern) => {
    try {
      return new RegExp(pattern, "i");
    } catch {
      return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
  });

  for (const relPath of allFiles) {
    if (matches.length >= maxResults) break;
    if (isBinaryExtension(relPath)) continue;
    const absPath = join(workspace, relPath);
    let content: string;
    try {
      content = await Bun.file(absPath).text();
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (regexes.some((regex) => regex.test(line))) {
        const lineText = (lines[i] ?? "").trimEnd();
        matches.push(`./${relPath}:${i + 1}:${lineText}`);
        if (matches.length >= maxResults) break;
      }
    }
  }

  return matches.length > 0 ? matches.join("\n") : "No matches.";
}

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

function isAllowedPath(pathInput: string, workspace: string): boolean {
  return isWithinWorkspace(pathInput, workspace) || isWithinTempRoot(pathInput, workspace);
}

function ensurePathWithinAllowedRoots(pathInput: string, operation: string, workspace: string): string {
  const absPath = resolveAgentPath(pathInput, workspace);
  if (!isAllowedPath(absPath, workspace)) throw new Error(`${operation} is restricted to the workspace or /tmp`);
  return absPath;
}

function extractAbsolutePathsFromCommand(command: string): string[] {
  const matches = command.match(/(?:^|[\s"'`])(\/[^\s"'`|;&<>]+)/g) ?? [];
  return matches.map((part) => part.trim().replace(/^["'`]/, ""));
}

function ensureCommandScopedToWorkspace(command: string, workspace: string): void {
  if (command.includes("../") || command.includes("..\\"))
    throw new Error("Command contains path traversal outside workspace");
  const absPaths = extractAbsolutePathsFromCommand(command);
  for (const absPath of absPaths) {
    if (!isAllowedPath(absPath, workspace)) throw new Error("Command references path outside workspace and /tmp");
  }
  if (/(?:^|[\s"'`])~\//.test(command)) throw new Error("Command references home path outside allowed roots");
}

function ensureWritePermission(operation: string): void {
  if (appConfig.agent.permissions.mode === "read") throw new Error(`${operation} is disabled in read mode`);
}

function displayPathForDiff(absPath: string, workspace: string): string {
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

function createDiff(path: string, previous: string | null, next: string): string {
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

  // Group into hunks with enough context for the display filter (contextRadius = 3).
  const contextSize = 5;
  const isChange = diffLines.map((l) => !l.startsWith(" "));
  const hunkRanges: Array<{ start: number; end: number }> = [];
  let hunkStart = -1;
  for (let i = 0; i < diffLines.length; i++) {
    if (isChange[i]) {
      if (hunkStart === -1) hunkStart = Math.max(0, i - contextSize);
      const hunkEnd = Math.min(diffLines.length, i + contextSize + 1);
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

function createUnifiedDeleteDiff(path: string, previous: string): string {
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

function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#x2F;", "/");
}

function stripHtmlTags(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const match172 = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (match172) {
    const second = Number.parseInt(match172[1] ?? "0", 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function parseWebUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error("Web fetch URL is invalid");
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") throw new Error("Web fetch only supports http/https URLs");
  if (isPrivateOrLocalHost(parsed.hostname)) throw new Error("Web fetch blocks localhost/private hosts");
  return parsed;
}

function extractHtmlText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripHtmlTags(titleMatch?.[1] ?? "").trim();
  const withoutHead = html.replace(/<head[\s\S]*?<\/head>/gi, " ");
  const withoutScripts = withoutHead
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  return {
    title,
    text: stripHtmlTags(withoutScripts),
  };
}

export async function fetchWeb(urlInput: string, maxChars = 5000): Promise<string> {
  const limit = Math.max(500, Math.min(12_000, maxChars));
  let current = parseWebUrl(urlInput);
  let redirects = 0;

  while (redirects <= 3) {
    let response: Response;
    try {
      response = await fetch(current.toString(), {
        redirect: "manual",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error(`Failed to fetch ${current.toString()} — site may be unreachable or URL is invalid.`);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Web fetch received redirect without location");
      current = parseWebUrl(new URL(location, current).toString());
      redirects += 1;
      continue;
    }
    if (!response.ok) throw new Error(`Web fetch failed with status ${response.status}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const raw = await response.text();
    const rendered = contentType.includes("text/html") ? extractHtmlText(raw) : { title: "", text: raw.trim() };
    const body = rendered.text.replace(/\s+/g, " ").trim();
    if (!body) return `Fetched: ${current.toString()}\nNo textual content found.`;
    const clipped = body.slice(0, limit);
    const lines = [`Fetched: ${current.toString()}`];
    if (rendered.title) lines.push(`Title: ${rendered.title}`);
    lines.push("Content:");
    lines.push(clipped);
    if (body.length > clipped.length) lines.push(`… clipped ${body.length - clipped.length} chars`);
    return lines.join("\n");
  }

  throw new Error("Web fetch stopped after too many redirects");
}

export async function searchWeb(query: string, maxResults = 5): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("Web search query cannot be empty");

  const limit = Math.max(1, Math.min(10, maxResults));
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`;
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36",
    },
  });
  if (!response.ok) throw new Error(`Web search failed with status ${response.status}`);
  const html = await response.text();

  const rows: Array<{ title: string; link: string; snippet: string }> = [];
  const resultBlockPattern = /<div class="result(?:.|\n|\r)*?<\/div>\s*<\/div>/g;
  const blocks = html.match(resultBlockPattern) ?? [];
  for (const block of blocks) {
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const link = decodeHtmlEntities(titleMatch[1] ?? "").trim();
    const title = stripHtmlTags(titleMatch[2] ?? "");
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = stripHtmlTags(snippetMatch?.[1] ?? "");
    if (!link || !title) continue;
    rows.push({ title, link, snippet });
    if (rows.length >= limit) break;
  }

  if (rows.length === 0) return `No web results found for: ${trimmed}`;

  const output = [`Web results for: ${trimmed}`];
  for (const [index, row] of rows.entries()) {
    output.push(`${index + 1}. ${row.title}`);
    output.push(`   ${row.link}`);
    if (row.snippet) output.push(`   ${row.snippet}`);
  }
  return output.join("\n");
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  return parsed;
}

export async function readSnippet(workspace: string, pathInput: string, start?: string, end?: string): Promise<string> {
  const absPath = ensurePathWithinAllowedRoots(pathInput, "Read", workspace);
  const raw = await readFile(absPath, "utf8");
  const lines = raw.split("\n");

  const from = toInt(start, 1);
  const to = Math.max(from, toInt(end, Math.min(from + 119, lines.length)));
  const slice = lines.slice(from - 1, to);
  const numbered = slice.map((line, idx) => `${from + idx}: ${line}`);

  return [`File: ${absPath}`, ...numbered].join("\n");
}

export async function readSnippets(
  workspace: string,
  entries: Array<{ path: string; start?: string; end?: string }>,
): Promise<string> {
  const results: string[] = [];
  for (const entry of entries) {
    results.push(await readSnippet(workspace, entry.path, entry.start, entry.end));
  }
  return results.join("\n\n");
}

export async function gitStatusShort(workspace: string): Promise<string> {
  const { code, stdout, stderr } = await runCommand(["git", "status", "--short"], workspace);
  if (code !== 0) throw new Error(stderr.trim() || "git status failed");
  return stdout.trim();
}

export async function gitDiff(workspace: string, pathInput?: string, contextLines = 3): Promise<string> {
  const args = ["git", "diff", `--unified=${contextLines}`];
  if (pathInput) {
    ensurePathWithinAllowedRoots(pathInput, "Diff", workspace);
    args.push("--", pathInput);
  }
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "git diff failed");
  return stdout.trim();
}

export async function gitLog(workspace: string, options?: { path?: string; limit?: number }): Promise<string> {
  const limit = Math.max(1, Math.min(50, options?.limit ?? 10));
  const args = ["git", "log", "--oneline", "--decorate", `-n`, String(limit)];
  if (options?.path) {
    ensurePathWithinAllowedRoots(options.path, "Log", workspace);
    args.push("--", options.path);
  }
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "git log failed");
  return stdout.trim();
}

export async function gitShow(
  workspace: string,
  options?: { ref?: string; path?: string; contextLines?: number },
): Promise<string> {
  const contextLines = Math.max(0, Math.min(20, options?.contextLines ?? 3));
  const ref = options?.ref?.trim() ? options.ref.trim() : "HEAD";
  const args = ["git", "show", "--no-color", `--unified=${contextLines}`, ref];
  if (options?.path) {
    ensurePathWithinAllowedRoots(options.path, "Show", workspace);
    args.push("--", options.path);
  }
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "git show failed");
  return stdout.trim();
}

export async function gitAdd(workspace: string, options?: { paths?: string[]; all?: boolean }): Promise<string> {
  const all = options?.all === true;
  const paths = (options?.paths ?? []).map((path) => path.trim()).filter((path) => path.length > 0);
  if (!all && paths.length === 0) throw new Error("git add requires at least one path when all=false");
  if (all && paths.length > 0) throw new Error("git add cannot combine all=true with explicit paths");
  for (const pathInput of paths) ensurePathWithinAllowedRoots(pathInput, "Add", workspace);
  const args = ["git", "add", ...(all ? ["-A"] : ["--", ...paths])];
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || "git add failed");
  const out = stdout.trim();
  return out.length > 0 ? out : "staged";
}

export async function gitCommit(workspace: string, options: { message: string; body?: string[] }): Promise<string> {
  const subject = options.message.trim();
  if (subject.length === 0) throw new Error("git commit message cannot be empty");
  const body = (options.body ?? []).map((line) => line.trim()).filter((line) => line.length > 0);
  const args = ["git", "commit", "-m", subject];
  for (const line of body) args.push("-m", line);
  const { code, stdout, stderr } = await runCommand(args, workspace);
  if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || "git commit failed");
  const out = stdout.trim();
  return out.length > 0 ? out : "committed";
}

const BLOCKED_SHELL_TOKENS = ["rm -rf /", "shutdown", "reboot", "mkfs", "dd if="];

type ShellChunk = {
  stream: "stdout" | "stderr";
  text: string;
};

async function readStreamText(
  stream: ReadableStream<Uint8Array> | null | undefined,
  streamName: "stdout" | "stderr",
  onChunk?: (chunk: ShellChunk) => void,
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let combined = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (!text) continue;
    combined += text;
    onChunk?.({ stream: streamName, text });
  }
  const tail = decoder.decode();
  if (tail) {
    combined += tail;
    onChunk?.({ stream: streamName, text: tail });
  }
  return combined;
}

export async function runShellCommand(
  workspace: string,
  command: string,
  timeoutMs = 60_000,
  onChunk?: (chunk: ShellChunk) => void,
): Promise<string> {
  ensureWritePermission("Shell command execution");
  const trimmed = command.trim();
  if (!trimmed) throw new Error("Command cannot be empty");
  const lower = trimmed.toLowerCase();
  if (BLOCKED_SHELL_TOKENS.some((token) => lower.includes(token))) throw new Error("Command contains blocked token");
  ensureCommandScopedToWorkspace(trimmed, workspace);

  const startedAt = Date.now();
  const proc = Bun.spawn({
    cmd: ["bash", "-lc", trimmed],
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // no-op
    }
  }, timeoutMs);

  const [stdoutText, stderrText] = await Promise.all([
    readStreamText(proc.stdout as ReadableStream<Uint8Array> | null, "stdout", onChunk),
    readStreamText(proc.stderr as ReadableStream<Uint8Array> | null, "stderr", onChunk),
  ]);
  const exitCode = await proc.exited;
  const durationMs = Date.now() - startedAt;
  clearTimeout(timer);

  const timedOut = durationMs >= timeoutMs;
  const headers = [
    timedOut ? `TIMED OUT after ${timeoutMs}ms` : "",
    `exit_code=${exitCode}`,
    `duration_ms=${durationMs}`,
  ].filter(Boolean);
  const out = stdoutText.trim();
  const err = stderrText.trim();
  if (!out && !err) return headers.join("\n");
  return [headers.join("\n"), out ? `stdout:\n${out}` : "", err ? `stderr:\n${err}` : ""].filter(Boolean).join("\n\n");
}

export type FindReplaceEdit = { find: string; replace: string };
export type LineRangeEdit = { startLine: number; endLine: number; replace: string };
export type FileEdit = FindReplaceEdit | LineRangeEdit;

export async function editFile(input: {
  workspace: string;
  path: string;
  edits: FileEdit[];
  dryRun?: boolean;
}): Promise<string> {
  ensureWritePermission("File editing");
  const absPath = ensurePathWithinAllowedRoots(input.path, "Edit", input.workspace);
  const raw = await readFile(absPath, "utf8");
  const lines = raw.split("\n");

  // Locate all match ranges in the original text.
  const ranges: Array<{ start: number; end: number; replace: string }> = [];
  for (const edit of input.edits) {
    if ("find" in edit) {
      if (!edit.find) throw new Error("Find text cannot be empty");
      if (edit.find.length > raw.length * 0.5) {
        throw new Error(
          "find must be a short unique snippet (a few lines), not a large portion of the file. Use just enough context to uniquely identify the edit location.",
        );
      }
      const count = raw.split(edit.find).length - 1;
      if (count === 0) throw new Error(`Find text not found in file: ${edit.find.slice(0, 60)}`);
      if (count > 1) {
        const message = `Find text matched ${count} locations (${edit.find.slice(0, 40)}…). Provide a longer, more unique snippet to match exactly one location, or use edit-code for multi-location code changes.`;
        throw createToolError(
          TOOL_ERROR_CODES.editFileMultiMatch,
          encodeToolError(TOOL_ERROR_CODES.editFileMultiMatch, message),
        );
      }
      const start = raw.indexOf(edit.find);
      ranges.push({ start, end: start + edit.find.length, replace: edit.replace });
    } else {
      const { startLine, endLine, replace } = edit;
      if (startLine < 1 || endLine < 1) throw new Error("Line numbers must be >= 1");
      if (startLine > endLine) throw new Error(`startLine (${startLine}) must be <= endLine (${endLine})`);
      const clampedEnd = Math.min(endLine, lines.length);
      if (clampedEnd !== endLine) {
        // Silently clamp — the model almost always means "to end of file".
      }
      // Convert 1-based inclusive line range to character offsets.
      let charStart = 0;
      for (let i = 0; i < startLine - 1; i++) {
        charStart += (lines[i]?.length ?? 0) + 1;
      }
      let charEnd = charStart;
      for (let i = startLine - 1; i <= clampedEnd - 1; i++) {
        charEnd += (lines[i]?.length ?? 0) + 1;
      }
      // If clampedEnd is the last line and file doesn't end with \n, don't overshoot.
      if (clampedEnd === lines.length && !raw.endsWith("\n")) charEnd -= 1;
      ranges.push({ start: charStart, end: charEnd, replace });
    }
  }

  // Check for overlaps.
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) {
    const prev = ranges[i - 1];
    const curr = ranges[i];
    if (prev && curr && curr.start < prev.end)
      throw new Error("Edit regions overlap. Use fewer, non-overlapping find snippets.");
  }

  // Detect likely duplication: replace text ends with lines that already follow the edit point.
  const DUPLICATION_MIN_LINES = 3;
  for (const r of ranges) {
    const afterRaw = raw.slice(r.end);
    const afterEdit = afterRaw.startsWith("\n") ? afterRaw.slice(1) : afterRaw;
    const replaceLines = r.replace.split("\n");
    const afterLines = afterEdit.split("\n");
    if (replaceLines.length >= DUPLICATION_MIN_LINES && afterLines.length >= DUPLICATION_MIN_LINES) {
      const tail = replaceLines.slice(-DUPLICATION_MIN_LINES);
      const head = afterLines.slice(0, DUPLICATION_MIN_LINES);
      const allMatch = tail.every((line, i) => line === head[i]);
      const nonTrivial = tail.some((line) => line.trim().length > 0);
      if (allMatch && nonTrivial) {
        throw new Error(
          "Replace text ends with lines that already follow the edit point — this would duplicate content. Only include the new/changed lines in replace, not the surrounding context.",
        );
      }
    }
  }

  // Apply in reverse order to preserve offsets.
  let next = raw;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    if (r) next = next.slice(0, r.start) + r.replace + next.slice(r.end);
  }

  if (!input.dryRun) {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, next, "utf8");
  }

  const relativePath = displayPathForDiff(absPath, input.workspace);
  const diff = createDiff(relativePath, raw, next);
  return [
    `path=${absPath}`,
    `edits=${input.edits.length}`,
    `dry_run=${input.dryRun ? "true" : "false"}`,
    "",
    diff,
  ].join("\n");
}

export async function writeTextFile(input: {
  workspace: string;
  path: string;
  content: string;
  overwrite?: boolean;
}): Promise<string> {
  ensureWritePermission("File writing");
  const absPath = ensurePathWithinAllowedRoots(input.path, "Write", input.workspace);
  const overwrite = input.overwrite ?? true;
  let previousContent: string | null = null;

  try {
    previousContent = await readFile(absPath, "utf8");
    if (!overwrite) throw new Error("Target file already exists");
  } catch (error) {
    if (!(error instanceof Error) || !/ENOENT/.test(error.message)) {
      if (error instanceof Error && error.message === "Target file already exists") throw error;
      throw error;
    }
  }

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, input.content, "utf8");
  const relativePath = displayPathForDiff(absPath, input.workspace);
  const diff = createDiff(relativePath, previousContent, input.content);
  const parts = [
    `path=${absPath}`,
    `bytes=${Buffer.byteLength(input.content, "utf8")}`,
    `overwritten=${overwrite ? "true" : "false"}`,
    "",
    diff,
  ];
  return parts.join("\n");
}

let dynamicLangsRegistered = false;

async function ensureDynamicLanguages(napi: typeof import("@ast-grep/napi")): Promise<void> {
  if (dynamicLangsRegistered) return;
  const langs: Record<string, unknown> = {};
  try {
    const { default: python } = await import("@ast-grep/lang-python");
    langs.python = python;
  } catch {
    /* optional */
  }
  try {
    const { default: rust } = await import("@ast-grep/lang-rust");
    langs.rust = rust;
  } catch {
    /* optional */
  }
  try {
    const { default: go } = await import("@ast-grep/lang-go");
    langs.go = go;
  } catch {
    /* optional */
  }
  if (Object.keys(langs).length > 0) {
    // biome-ignore lint/suspicious/noExplicitAny: ast-grep dynamic language API has loose types
    napi.registerDynamicLanguage(langs as any);
  }
  dynamicLangsRegistered = true;
}

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "Tsx",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".html": "Html",
  ".css": "Css",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
};

function languageFromPath(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return "TypeScript";
  return LANGUAGE_MAP[filePath.slice(dot).toLowerCase()] ?? "TypeScript";
}

function isParseable(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 && filePath.slice(dot).toLowerCase() in LANGUAGE_MAP;
}

function extractMetavariables(pattern: string): string[] {
  const matches = pattern.match(/\$[A-Z_][A-Z0-9_]*/g);
  if (!matches) return [];
  return Array.from(new Set(matches));
}

export async function editCode(input: {
  workspace: string;
  path: string;
  edits: Array<{ pattern: string; replacement: string }>;
  dryRun?: boolean;
}): Promise<string> {
  ensureWritePermission("AST editing");
  const absPath = ensurePathWithinAllowedRoots(input.path, "AST edit", input.workspace);
  const pathStats = await stat(absPath);
  if (!pathStats.isFile()) throw new Error(`edit-code requires a file path, got: ${input.path}`);
  const original = await readFile(absPath, "utf8");

  let napi: typeof import("@ast-grep/napi");
  try {
    napi = await import("@ast-grep/napi");
  } catch {
    throw new Error("@ast-grep/napi is not installed — run `bun add @ast-grep/napi`");
  }

  await ensureDynamicLanguages(napi);

  const langName = languageFromPath(absPath);
  const langEnum = napi.Lang[langName as keyof typeof napi.Lang];
  let current = original;
  let totalMatches = 0;

  // Apply each pattern sequentially (reparse between patterns).
  for (const edit of input.edits) {
    const tree = napi.parse(langEnum ?? langName, current);
    const matches = tree.root().findAll({ rule: { pattern: edit.pattern } });
    if (matches.length === 0) throw new Error(`No AST matches found for pattern: ${edit.pattern}`);
    totalMatches += matches.length;

    const metavars = extractMetavariables(edit.pattern);
    const replacements: Array<{ start: number; end: number; replacement: string }> = [];
    for (const match of matches) {
      let replaced = edit.replacement;
      for (const metavar of metavars) {
        const captured = match.getMatch(metavar.slice(1));
        if (captured) replaced = replaced.replaceAll(metavar, captured.text());
      }
      const range = match.range();
      replacements.push({ start: range.start.index, end: range.end.index, replacement: replaced });
    }

    replacements.sort((a, b) => b.start - a.start);
    for (const r of replacements) {
      current = current.slice(0, r.start) + r.replacement + current.slice(r.end);
    }
  }

  if (!input.dryRun) {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, current, "utf8");
  }

  const relativePath = displayPathForDiff(absPath, input.workspace);
  const diff = createDiff(relativePath, original, current);
  return [
    `path=${absPath}`,
    `edits=${input.edits.length}`,
    `matches=${totalMatches}`,
    `dry_run=${input.dryRun ? "true" : "false"}`,
    "",
    diff,
  ].join("\n");
}

export async function deleteTextFile(input: { workspace: string; path: string; dryRun?: boolean }): Promise<string> {
  ensureWritePermission("File deletion");
  const absPath = ensurePathWithinAllowedRoots(input.path, "Delete", input.workspace);
  const previousContent = await readFile(absPath, "utf8");
  const dryRun = input.dryRun ?? false;
  if (!dryRun) await unlink(absPath);
  const relativePath = displayPathForDiff(absPath, input.workspace);
  const diff = createUnifiedDeleteDiff(relativePath, previousContent);
  return [
    `path=${absPath}`,
    `bytes=${Buffer.byteLength(previousContent, "utf8")}`,
    `dry_run=${dryRun ? "true" : "false"}`,
    "",
    diff,
  ].join("\n");
}

export async function scanCode(input: {
  workspace: string;
  paths: string[];
  pattern: string | string[];
  language?: string;
  maxResults?: number;
}): Promise<string> {
  const maxResults = input.maxResults ?? 50;
  const patterns = Array.isArray(input.pattern) ? input.pattern : [input.pattern];

  let napi: typeof import("@ast-grep/napi");
  try {
    napi = await import("@ast-grep/napi");
  } catch {
    throw new Error("@ast-grep/napi is not installed — run `bun add @ast-grep/napi`");
  }
  await ensureDynamicLanguages(napi);

  type Match = { relPath: string; line: number; text: string; captures: Record<string, string> };
  type PatternResult = { pattern: string; matches: Match[] };
  const results: PatternResult[] = patterns.map((p) => ({ pattern: p, matches: [] }));

  const totalMatches = () => results.reduce((sum, r) => sum + r.matches.length, 0);

  const scanFile = (relPath: string, content: string, lang: string): void => {
    const langEnum = napi.Lang[lang as keyof typeof napi.Lang];
    let tree: ReturnType<typeof napi.parse>;
    try {
      tree = napi.parse(langEnum ?? lang, content);
    } catch {
      return; // skip unparseable files
    }
    for (const pr of results) {
      if (totalMatches() >= maxResults) return;
      const metavars = extractMetavariables(pr.pattern);
      const found = tree.root().findAll({ rule: { pattern: pr.pattern } });
      for (const m of found) {
        if (totalMatches() >= maxResults) return;
        const range = m.range();
        const text = m.text().split("\n")[0] ?? "";
        const captures: Record<string, string> = {};
        for (const mv of metavars) {
          const captured = m.getMatch(mv.slice(1));
          if (captured) captures[mv] = captured.text();
        }
        pr.matches.push({ relPath, line: range.start.line + 1, text, captures });
      }
    }
  };

  let scanned = 0;

  const scanPath = async (rawPath: string) => {
    const absPath = ensurePathWithinAllowedRoots(rawPath, "Scan", input.workspace);
    const info = await stat(absPath);

    if (info.isFile()) {
      const content = await readFile(absPath, "utf8");
      const lang = input.language ?? languageFromPath(absPath);
      scanned++;
      scanFile(displayPathForDiff(absPath, input.workspace), content, lang);
    } else if (info.isDirectory()) {
      const stack: string[] = [absPath];
      const maxFiles = 500;
      while (stack.length > 0 && scanned < maxFiles && totalMatches() < maxResults) {
        const dir = stack.pop();
        if (!dir) break;
        let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (entry.name.startsWith(".") && entry.isDirectory()) continue;
          if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
          const abs = join(dir, entry.name);
          if (entry.isDirectory()) {
            stack.push(abs);
          } else if (entry.isFile() && isParseable(abs)) {
            if (scanned >= maxFiles || totalMatches() >= maxResults) break;
            const lang = input.language ?? languageFromPath(abs);
            try {
              const content = await readFile(abs, "utf8");
              scanned++;
              scanFile(displayPathForDiff(abs, input.workspace), content, lang);
            } catch {
              /* skip unreadable files */
            }
          }
        }
      }
    } else {
      throw new Error(`Path is not a file or directory: ${absPath}`);
    }
  };

  for (const p of input.paths) {
    if (totalMatches() >= maxResults) break;
    await scanPath(p);
  }

  const total = totalMatches();
  const lines: string[] = [`scanned=${scanned} matches=${total}`];
  const multi = patterns.length > 1;
  for (const pr of results) {
    if (multi) lines.push(`--- pattern: ${pr.pattern} ---`);
    for (const m of pr.matches) {
      const truncated = m.text.length > 80 ? `${m.text.slice(0, 77)}...` : m.text;
      const captureStr =
        Object.keys(m.captures).length > 0
          ? `  {${Object.entries(m.captures)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}}`
          : "";
      lines.push(`${m.relPath}:${m.line}: ${truncated}${captureStr}`);
    }
    if (multi && pr.matches.length === 0) lines.push("No matches.");
  }
  if (!multi && total === 0) lines.push("No matches.");
  return lines.join("\n");
}
