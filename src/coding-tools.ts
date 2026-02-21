import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const WORKSPACE_ROOT = resolve(process.cwd());

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

function isWithinWorkspace(pathInput: string): boolean {
  const absPath = resolve(pathInput);
  return absPath === WORKSPACE_ROOT || absPath.startsWith(`${WORKSPACE_ROOT}/`);
}

function ensurePathWithinWorkspace(pathInput: string, operation: string): string {
  const absPath = resolve(pathInput);
  if (!isWithinWorkspace(absPath)) {
    throw new Error(`${operation} is restricted to the current workspace`);
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
    if (!isWithinWorkspace(absPath)) {
      throw new Error("Command references absolute path outside workspace");
    }
  }
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
  const absPath = ensurePathWithinWorkspace(pathInput, "Read");
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
    ensurePathWithinWorkspace(pathInput, "Diff");
    args.push("--", pathInput);
  }
  const { code, stdout, stderr } = await runCommand(args);
  if (code !== 0) {
    throw new Error(stderr.trim() || "git diff failed");
  }
  return stdout.trim() || "No unstaged changes.";
}

const BLOCKED_SHELL_TOKENS = ["rm -rf /", "shutdown", "reboot", "mkfs", "dd if="];

export async function runShellCommand(command: string, timeoutMs = 60_000): Promise<string> {
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
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
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
  const absPath = ensurePathWithinWorkspace(input.path, "Edit");
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

  return [`path=${absPath}`, `matches=${count}`, `dry_run=${input.dryRun ? "true" : "false"}`].join("\n");
}
