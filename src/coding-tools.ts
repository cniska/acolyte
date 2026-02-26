import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { appConfig } from "./app-config";

const WORKSPACE_ROOT = resolve(process.cwd());
const TEMP_ROOTS = Array.from(new Set([resolve(tmpdir()), resolve("/tmp"), resolve("/private/tmp")]));

async function runCommand(cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd,
    cwd: WORKSPACE_ROOT,
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

export async function searchRepo(pattern: string, maxResults = 40): Promise<string> {
  const trimmed = pattern.trim();
  if (!trimmed) {
    throw new Error("Search pattern cannot be empty");
  }
  const isFilenameLike = !/\s/.test(trimmed) && (trimmed.includes("/") || /\.[a-z0-9]+$/i.test(trimmed));

  if (isFilenameLike) {
    const { code, stdout, stderr } = await runCommand(["rg", "--files", "--color", "never", "."]);
    if (code !== 0 && stdout.trim().length === 0) {
      const err = stderr.trim();
      return err.length > 0 ? `No matches. (${err})` : "No matches.";
    }
    const needle = trimmed.replace(/^\.\/+/, "").toLowerCase();
    const fileLines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const ranked = fileLines
      .filter((line) => line.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const aExact = aLower === needle ? 0 : aLower.endsWith(`/${needle}`) ? 1 : 2;
        const bExact = bLower === needle ? 0 : bLower.endsWith(`/${needle}`) ? 1 : 2;
        if (aExact !== bExact) {
          return aExact - bExact;
        }
        return a.length - b.length;
      })
      .slice(0, maxResults)
      .map((line) => `./${line}`);
    return ranked.length > 0 ? ranked.join("\n") : "No matches.";
  }

  const {
    code: exitCode,
    stdout: stdoutText,
    stderr: stderrText,
  } = await runCommand(["rg", "--line-number", "--color", "never", "--max-count", String(maxResults), trimmed, "."]);

  if (exitCode !== 0 && stdoutText.trim().length === 0) {
    const err = stderrText.trim();
    if (err.length > 0) {
      return `No matches. (${err})`;
    }
    return "No matches.";
  }

  return stdoutText.trim() || "No matches.";
}

const IGNORED_DIRS = new Set(["node_modules", ".git", ".acolyte", "dist", "build", ".next", "coverage"]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".zip", ".gz", ".tar", ".bz2", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt",
  ".exe", ".dll", ".so", ".dylib", ".bin",
  ".mp3", ".mp4", ".avi", ".mov", ".wav", ".flac",
  ".wasm", ".pyc", ".class", ".o", ".a",
  ".sqlite", ".db",
  ".lock",
]);

function isBinaryExtension(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) {
    return false;
  }
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

async function collectWorkspaceFiles(maxEntries = 5000): Promise<string[]> {
  const out: string[] = [];
  const stack: Array<{ abs: string; rel: string }> = [{ abs: WORKSPACE_ROOT, rel: "" }];

  while (stack.length > 0 && out.length < maxEntries) {
    const current = stack.pop();
    if (!current) {
      break;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await readdir(current.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.isDirectory()) {
        continue;
      }
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      const abs = join(current.abs, entry.name);
      if (entry.isDirectory()) {
        stack.push({ abs, rel });
      } else if (entry.isFile()) {
        out.push(rel);
      }
      if (out.length >= maxEntries) {
        break;
      }
    }
  }

  return out;
}

export async function findFiles(pattern: string, maxResults = 40): Promise<string> {
  const trimmed = pattern.trim();
  if (!trimmed) {
    throw new Error("Search pattern cannot be empty");
  }
  const allFiles = await collectWorkspaceFiles();
  const needle = trimmed.replace(/^\.\/+/, "").toLowerCase();

  const ranked = allFiles
    .filter((path) => path.toLowerCase().includes(needle))
    .sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aScore = aLower === needle ? 0 : aLower.endsWith(`/${needle}`) ? 1 : 2;
      const bScore = bLower === needle ? 0 : bLower.endsWith(`/${needle}`) ? 1 : 2;
      if (aScore !== bScore) {
        return aScore - bScore;
      }
      return a.length - b.length;
    })
    .slice(0, maxResults)
    .map((path) => `./${path}`);

  return ranked.length > 0 ? ranked.join("\n") : "No matches.";
}

export async function searchFiles(pattern: string, maxResults = 40): Promise<string> {
  const trimmed = pattern.trim();
  if (!trimmed) {
    throw new Error("Search pattern cannot be empty");
  }
  const allFiles = await collectWorkspaceFiles();
  const matches: string[] = [];

  let regex: RegExp;
  try {
    regex = new RegExp(trimmed, "i");
  } catch {
    regex = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }

  for (const relPath of allFiles) {
    if (matches.length >= maxResults) {
      break;
    }
    if (isBinaryExtension(relPath)) {
      continue;
    }
    const absPath = join(WORKSPACE_ROOT, relPath);
    let content: string;
    try {
      content = await Bun.file(absPath).text();
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i] ?? "")) {
        const lineText = (lines[i] ?? "").trimEnd();
        matches.push(`./${relPath}:${i + 1}:${lineText}`);
        if (matches.length >= maxResults) {
          break;
        }
      }
    }
  }

  return matches.length > 0 ? matches.join("\n") : "No matches.";
}

function isWithinWorkspace(pathInput: string): boolean {
  const absPath = resolve(pathInput);
  return absPath === WORKSPACE_ROOT || absPath.startsWith(`${WORKSPACE_ROOT}/`);
}

function isWithinTempRoot(pathInput: string): boolean {
  const absPath = resolve(pathInput);
  return TEMP_ROOTS.some((root) => absPath === root || absPath.startsWith(`${root}/`));
}

function isAllowedPath(pathInput: string): boolean {
  return isWithinWorkspace(pathInput) || isWithinTempRoot(pathInput);
}

function ensurePathWithinAllowedRoots(pathInput: string, operation: string): string {
  const absPath = resolve(pathInput);
  if (!isAllowedPath(absPath)) {
    throw new Error(`${operation} is restricted to the workspace or /tmp`);
  }
  return absPath;
}

function extractAbsolutePathsFromCommand(command: string): string[] {
  const matches = command.match(/(?:^|[\s"'`])(\/[^\s"'`|;&<>]+)/g) ?? [];
  return matches.map((part) => part.trim().replace(/^["'`]/, ""));
}

function ensureCommandScopedToWorkspace(command: string): void {
  if (command.includes("../") || command.includes("..\\")) {
    throw new Error("Command contains path traversal outside workspace");
  }
  const absPaths = extractAbsolutePathsFromCommand(command);
  for (const absPath of absPaths) {
    if (!isAllowedPath(absPath)) {
      throw new Error("Command references path outside workspace and /tmp");
    }
  }
  if (/(?:^|[\s"'`])~\//.test(command)) {
    throw new Error("Command references home path outside allowed roots");
  }
}

function ensureWritePermission(operation: string): void {
  if (appConfig.agent.permissions.mode === "read") {
    throw new Error(`${operation} is disabled in read mode`);
  }
}

function displayPathForDiff(absPath: string): string {
  if (absPath === WORKSPACE_ROOT) {
    return ".";
  }
  if (absPath.startsWith(`${WORKSPACE_ROOT}/`)) {
    return absPath.slice(WORKSPACE_ROOT.length + 1);
  }
  return absPath;
}

function contentLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function buildUnifiedWriteDiff(path: string, previous: string | null, next: string): string {
  const oldLines = previous == null ? [] : contentLines(previous);
  const newLines = contentLines(next);
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const header = [
    `diff --git a/${path} b/${path}`,
    ...(previous == null ? ["new file mode 100644"] : []),
    `--- ${previous == null ? "/dev/null" : `a/${path}`}`,
    `+++ b/${path}`,
    `@@ -${previous == null ? 0 : 1},${oldCount} +1,${newCount} @@`,
  ];
  const removed = oldLines.map((line) => `-${line}`);
  const added = newLines.map((line) => `+${line}`);
  return [...header, ...removed, ...added].join("\n");
}

function buildUnifiedDeleteDiff(path: string, previous: string): string {
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
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) {
    return true;
  }
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return true;
  }
  const match172 = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (match172) {
    const second = Number.parseInt(match172[1] ?? "0", 10);
    if (second >= 16 && second <= 31) {
      return true;
    }
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
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("Web fetch only supports http/https URLs");
  }
  if (isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error("Web fetch blocks localhost/private hosts");
  }
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
    const response = await fetch(current.toString(), {
      redirect: "manual",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Web fetch received redirect without location");
      }
      current = parseWebUrl(new URL(location, current).toString());
      redirects += 1;
      continue;
    }
    if (!response.ok) {
      throw new Error(`Web fetch failed with status ${response.status}`);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const raw = await response.text();
    const rendered = contentType.includes("text/html") ? extractHtmlText(raw) : { title: "", text: raw.trim() };
    const body = rendered.text.replace(/\s+/g, " ").trim();
    if (!body) {
      return `Fetched: ${current.toString()}\nNo textual content found.`;
    }
    const clipped = body.slice(0, limit);
    const lines = [`Fetched: ${current.toString()}`];
    if (rendered.title) {
      lines.push(`Title: ${rendered.title}`);
    }
    lines.push("Content:");
    lines.push(clipped);
    if (body.length > clipped.length) {
      lines.push(`… clipped ${body.length - clipped.length} chars`);
    }
    return lines.join("\n");
  }

  throw new Error("Web fetch stopped after too many redirects");
}

export async function searchWeb(query: string, maxResults = 5): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Web search query cannot be empty");
  }

  const limit = Math.max(1, Math.min(10, maxResults));
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`;
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Web search failed with status ${response.status}`);
  }
  const html = await response.text();

  const rows: Array<{ title: string; link: string; snippet: string }> = [];
  const resultBlockPattern = /<div class="result(?:.|\n|\r)*?<\/div>\s*<\/div>/g;
  const blocks = html.match(resultBlockPattern) ?? [];
  for (const block of blocks) {
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) {
      continue;
    }
    const link = decodeHtmlEntities(titleMatch[1] ?? "").trim();
    const title = stripHtmlTags(titleMatch[2] ?? "");
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = stripHtmlTags(snippetMatch?.[1] ?? "");
    if (!link || !title) {
      continue;
    }
    rows.push({ title, link, snippet });
    if (rows.length >= limit) {
      break;
    }
  }

  if (rows.length === 0) {
    return `No web results found for: ${trimmed}`;
  }

  const output = [`Web results for: ${trimmed}`];
  for (const [index, row] of rows.entries()) {
    output.push(`${index + 1}. ${row.title}`);
    output.push(`   ${row.link}`);
    if (row.snippet) {
      output.push(`   ${row.snippet}`);
    }
  }
  return output.join("\n");
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

export async function readSnippet(pathInput: string, start?: string, end?: string): Promise<string> {
  const absPath = ensurePathWithinAllowedRoots(pathInput, "Read");
  const raw = await readFile(absPath, "utf8");
  const lines = raw.split("\n");

  const from = toInt(start, 1);
  const to = Math.max(from, toInt(end, Math.min(from + 119, lines.length)));
  const slice = lines.slice(from - 1, to);
  const numbered = slice.map((line, idx) => `${from + idx}: ${line}`);

  return [`File: ${absPath}`, ...numbered].join("\n");
}

export async function gitStatusShort(): Promise<string> {
  const { code, stdout, stderr } = await runCommand(["git", "status", "--short", "--branch"]);
  if (code !== 0) {
    throw new Error(stderr.trim() || "git status failed");
  }
  return stdout.trim() || "Working tree clean.";
}

export async function gitDiff(pathInput?: string, contextLines = 3): Promise<string> {
  const args = ["git", "diff", `--unified=${contextLines}`];
  if (pathInput) {
    ensurePathWithinAllowedRoots(pathInput, "Diff");
    args.push("--", pathInput);
  }
  const { code, stdout, stderr } = await runCommand(args);
  if (code !== 0) {
    throw new Error(stderr.trim() || "git diff failed");
  }
  return stdout.trim() || "No unstaged changes.";
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
  if (!stream) {
    return "";
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let combined = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const text = decoder.decode(value, { stream: true });
    if (!text) {
      continue;
    }
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
  command: string,
  timeoutMs = 60_000,
  onChunk?: (chunk: ShellChunk) => void,
): Promise<string> {
  ensureWritePermission("Shell command execution");
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command cannot be empty");
  }
  const lower = trimmed.toLowerCase();
  if (BLOCKED_SHELL_TOKENS.some((token) => lower.includes(token))) {
    throw new Error("Command contains blocked token");
  }
  ensureCommandScopedToWorkspace(trimmed);

  const startedAt = Date.now();
  const proc = Bun.spawn({
    cmd: ["bash", "-lc", trimmed],
    cwd: WORKSPACE_ROOT,
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

  const headers = [`exit_code=${exitCode}`, `duration_ms=${durationMs}`];
  const out = stdoutText.trim();
  const err = stderrText.trim();
  if (!out && !err) {
    return headers.join("\n");
  }
  return [headers.join("\n"), out ? `stdout:\n${out}` : "", err ? `stderr:\n${err}` : ""].filter(Boolean).join("\n\n");
}

export async function editFileReplace(input: {
  path: string;
  find: string;
  replace: string;
  dryRun?: boolean;
}): Promise<string> {
  ensureWritePermission("File editing");
  const absPath = ensurePathWithinAllowedRoots(input.path, "Edit");
  const raw = await readFile(absPath, "utf8");

  if (!input.find) {
    throw new Error("Find text cannot be empty");
  }

  const count = raw.split(input.find).length - 1;
  if (count === 0) {
    throw new Error("Find text not found in file");
  }

  const next = raw.replaceAll(input.find, input.replace);
  if (!input.dryRun) {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, next, "utf8");
  }

  const relativePath = displayPathForDiff(absPath);
  const diff = buildUnifiedWriteDiff(relativePath, raw, next);
  return [`path=${absPath}`, `matches=${count}`, `dry_run=${input.dryRun ? "true" : "false"}`, "", diff].join("\n");
}

export async function writeTextFile(input: { path: string; content: string; overwrite?: boolean }): Promise<string> {
  ensureWritePermission("File writing");
  const absPath = ensurePathWithinAllowedRoots(input.path, "Write");
  const overwrite = input.overwrite ?? true;
  let previousContent: string | null = null;

  try {
    previousContent = await readFile(absPath, "utf8");
    if (!overwrite) {
      throw new Error("Target file already exists");
    }
  } catch (error) {
    if (!(error instanceof Error) || !/ENOENT/.test(error.message)) {
      if (error instanceof Error && error.message === "Target file already exists") {
        throw error;
      }
      throw error;
    }
  }

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, input.content, "utf8");
  const relativePath = displayPathForDiff(absPath);
  const diff = buildUnifiedWriteDiff(relativePath, previousContent, input.content);
  return [
    `path=${absPath}`,
    `bytes=${Buffer.byteLength(input.content, "utf8")}`,
    `overwritten=${overwrite ? "true" : "false"}`,
    "",
    diff,
  ].join("\n");
}

export async function deleteTextFile(input: { path: string; dryRun?: boolean }): Promise<string> {
  ensureWritePermission("File deletion");
  const absPath = ensurePathWithinAllowedRoots(input.path, "Delete");
  const previousContent = await readFile(absPath, "utf8");
  const dryRun = input.dryRun ?? false;
  if (!dryRun) {
    await unlink(absPath);
  }
  const relativePath = displayPathForDiff(absPath);
  const diff = buildUnifiedDeleteDiff(relativePath, previousContent);
  return [
    `path=${absPath}`,
    `bytes=${Buffer.byteLength(previousContent, "utf8")}`,
    `dry_run=${dryRun ? "true" : "false"}`,
    "",
    diff,
  ].join("\n");
}
