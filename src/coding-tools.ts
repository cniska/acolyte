import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function runCommand(cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd,
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

  const { code: exitCode, stdout: stdoutText, stderr: stderrText } = await runCommand([
    "rg",
    "--line-number",
    "--color",
    "never",
    "--max-count",
    String(maxResults),
    trimmed,
    ".",
  ]);

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

  const proc = Bun.spawn({
    cmd: ["bash", "-lc", trimmed],
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
  clearTimeout(timer);

  const header = `exit_code=${exitCode}`;
  const out = stdoutText.trim();
  const err = stderrText.trim();
  if (!out && !err) {
    return header;
  }
  return [header, out ? `stdout:\n${out}` : "", err ? `stderr:\n${err}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

export async function runTestCommand(command = "bun run test"): Promise<string> {
  return runShellCommand(command, 120_000);
}
