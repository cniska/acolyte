import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function searchRepo(pattern: string, maxResults = 40): Promise<string> {
  const trimmed = pattern.trim();
  if (!trimmed) {
    throw new Error("Search pattern cannot be empty");
  }

  const proc = Bun.spawn({
    cmd: ["rg", "--line-number", "--color", "never", "--max-count", String(maxResults), trimmed, "."],
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutText, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  if (exitCode !== 0 && stdoutText.trim().length === 0) {
    const err = stderrText.trim();
    if (err.length > 0) {
      return `No matches. (${err})`;
    }
    return "No matches.";
  }

  return stdoutText.trim() || "No matches.";
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
  const absPath = resolve(pathInput);
  const raw = await readFile(absPath, "utf8");
  const lines = raw.split("\n");

  const from = toInt(start, 1);
  const to = Math.max(from, toInt(end, Math.min(from + 119, lines.length)));
  const slice = lines.slice(from - 1, to);
  const numbered = slice.map((line, idx) => `${from + idx}: ${line}`);

  return [`File: ${absPath}`, ...numbered].join("\n");
}

