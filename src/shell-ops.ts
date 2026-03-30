import { basename } from "node:path";
import { z } from "zod";
import { ensurePathWithinSandbox, sandboxViolationError } from "./workspace-sandbox";

const BLOCKED_EXECUTABLES = new Set(["shutdown", "reboot", "mkfs", "dd"]);
const SAFE_ENV_KEYS = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
  "COLORTERM",
  "ComSpec",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
] as const;

const exitCodeSchema = z.coerce.number().int();

type ShellChunk = {
  stream: "stdout" | "stderr";
  text: string;
};

export type ShellCommandInput = {
  cmd: string;
  args?: readonly string[];
};

function formatDisplayToken(token: string): string {
  if (token.length === 0) return "''";
  if (!/[\s"'`\\$]/.test(token)) return token;
  return `'${token.replace(/'/g, `'\\''`)}'`;
}

export function formatShellCommand(input: ShellCommandInput): string {
  const args = input.args ?? [];
  return [formatDisplayToken(input.cmd), ...args.map((arg) => formatDisplayToken(arg))].join(" ").trim();
}

function looksLikeWindowsAbsolutePath(token: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(token) || /^\\\\[^\\]/.test(token);
}

function isPathLikeToken(token: string): boolean {
  if (token === "." || token === "..") return true;
  if (token.startsWith("/") || token.startsWith("./") || token.startsWith("../")) return true;
  if (token.startsWith(".\\") || token.startsWith("..\\")) return true;
  if (looksLikeWindowsAbsolutePath(token)) return true;
  return token.includes("/") || token.includes("\\");
}

function maybeExtractAssignedValue(token: string): string | undefined {
  const equalsIndex = token.indexOf("=");
  if (equalsIndex <= 0 || equalsIndex === token.length - 1) return undefined;
  return token.slice(equalsIndex + 1);
}

function normalizeExecutableName(cmd: string): string {
  const base = basename(cmd).toLowerCase();
  return base.endsWith(".exe") ? base.slice(0, -4) : base;
}

function ensureTokenWithinSandbox(token: string, workspace: string): void {
  if (!token) return;
  if (token.startsWith("~")) throw sandboxViolationError("homePath");

  // Check KEY=VALUE assignments before path-like detection so that tokens like
  // "OUT=/etc/passwd" are parsed as an assignment, not treated as a bare path.
  const assignedValue = maybeExtractAssignedValue(token);
  if (assignedValue !== undefined) {
    if (assignedValue.startsWith("~")) throw sandboxViolationError("homePath");
    if (isPathLikeToken(assignedValue)) ensurePathWithinSandbox(assignedValue, workspace);
    return;
  }

  if (isPathLikeToken(token)) {
    ensurePathWithinSandbox(token, workspace);
    return;
  }

  // Bare tokens: check unconditionally so workspace-resident symlinks pointing
  // outside the sandbox are caught even when the token has no path separators.
  ensurePathWithinSandbox(token, workspace);
}

function ensureCommandScopedToWorkspace(input: ShellCommandInput, workspace: string): void {
  const cmd = input.cmd.trim();
  const args = input.args ?? [];

  if (!cmd) throw new Error("Command cannot be empty");
  if (cmd.startsWith("~")) throw sandboxViolationError("homePath");
  if (isPathLikeToken(cmd)) ensurePathWithinSandbox(cmd, workspace);
  if (BLOCKED_EXECUTABLES.has(normalizeExecutableName(cmd))) throw new Error("Command contains blocked executable");

  for (const arg of args) ensureTokenWithinSandbox(arg, workspace);
}

function createRestrictedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  const fallbackPath = process.env.PATH ?? process.env.Path;
  if (typeof fallbackPath === "string" && fallbackPath.length > 0) {
    env.PATH = fallbackPath;
    env.Path = fallbackPath;
  }
  return env;
}

async function readStreamText(
  stream: ReadableStream<Uint8Array> | null | undefined,
  streamName: "stdout" | "stderr",
  onChunk?: (chunk: ShellChunk) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let combined = "";
  const onAbort = (): void => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
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
  } catch {
    // Stream cancelled by abort signal — return what we have.
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  return combined;
}

export async function runShellCommand(
  workspace: string,
  input: ShellCommandInput,
  timeoutMs = 60_000,
  onChunk?: (chunk: ShellChunk) => void,
): Promise<string> {
  const cmd = input.cmd.trim();
  if (!cmd) throw new Error("Command cannot be empty");
  const args = [...(input.args ?? [])];
  ensureCommandScopedToWorkspace({ cmd, args }, workspace);

  const startedAt = Date.now();
  const controller = new AbortController();
  const proc = Bun.spawn({
    cmd: [cmd, ...args],
    cwd: workspace,
    env: createRestrictedEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    try {
      proc.kill(9);
    } catch {
      // no-op
    }
    // Abort stream readers in case child processes keep pipes open after kill.
    controller.abort();
  }, timeoutMs);

  const [stdoutText, stderrText] = await Promise.all([
    readStreamText(proc.stdout as ReadableStream<Uint8Array> | null, "stdout", onChunk, controller.signal),
    readStreamText(proc.stderr as ReadableStream<Uint8Array> | null, "stderr", onChunk, controller.signal),
  ]);
  const exitCode = await proc.exited;
  const durationMs = Date.now() - startedAt;
  clearTimeout(timer);

  const timedOut = durationMs >= timeoutMs || controller.signal.aborted;
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

export function parseExitCode(result: string): number | undefined {
  const first = result.split("\n")[0]?.trim() ?? "";
  if (!first.startsWith("exit_code=")) return undefined;
  const parsed = exitCodeSchema.safeParse(first.slice("exit_code=".length));
  return parsed.success ? parsed.data : undefined;
}
