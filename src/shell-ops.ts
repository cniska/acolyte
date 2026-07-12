import { basename } from "node:path";
import { z } from "zod";
import { ensurePathWithinSandbox, sandboxViolationError } from "./workspace-sandbox";

const BLOCKED_EXECUTABLES = new Set(["shutdown", "reboot", "mkfs", "dd"]);
const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "CI",
  "NO_COLOR",
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
  if (token.startsWith("-")) return false;
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

function isStrippableControlChar(code: number): boolean {
  // Keep LF and TAB; drop the other C0 controls, DEL, and C1 (0x80-0x9f).
  if (code === 0x0a || code === 0x09) return false;
  if (code < 0x20) return true;
  if (code === 0x7f) return true;
  return code >= 0x80 && code <= 0x9f;
}

// Index past a complete ESC sequence starting at `i` (input[i] === ESC), or -1 if it runs to
// the end of the buffer unterminated (so the caller carries it into the next chunk).
function skipEscape(input: string, i: number): number {
  const next = input[i + 1];
  if (next === undefined) return -1;
  if (next === "[") {
    // CSI: parameter/intermediate bytes (0x20-0x3f) then a final byte (0x40-0x7e). Any byte
    // outside 0x20-0x7e can't appear in a valid CSI, so treat it as an aborted/truncated
    // sequence and hand it back to the scanner rather than swallowing it and the text after it.
    for (let j = i + 2; j < input.length; j++) {
      const code = input.charCodeAt(j);
      if (code < 0x20 || code > 0x7e) return j;
      if (code >= 0x40) return j + 1;
    }
    return -1;
  }
  if (next === "]" || next === "P" || next === "_" || next === "^" || next === "X") {
    // OSC / DCS / APC / PM / SOS: string terminated by BEL or ST (ESC \).
    for (let j = i + 2; j < input.length; j++) {
      if (input[j] === "\x07") return j + 1;
      if (input[j] === "\x1b") {
        if (input[j + 1] === undefined) return -1;
        if (input[j + 1] === "\\") return j + 2;
      }
    }
    return -1;
  }
  if (next === "(" || next === ")" || next === "*" || next === "+") {
    // Charset designator: ESC ( <one byte>.
    return input[i + 2] === undefined ? -1 : i + 3;
  }
  return i + 2; // Other single-byte escapes (ESC 7, ESC M, ...).
}

// Subprocess stdout is arbitrary bytes — build/test tools emit VT control sequences (screen
// clears, cursor moves, OSC title/hyperlink/clipboard, color). Those bytes are data in
// Acolyte's transcript, not commands: left raw they wipe the screen in run mode (`ui.ts`
// writes straight to the TTY) and pollute the model-facing result and the session record.
// Scrub at capture so all three sinks are clean. Stateful because a CSI/OSC sequence or a CR
// can straddle a chunk boundary — the unresolved tail is carried into the next push.
export function createControlSequenceScrubber(): { push(text: string): string; flush(): string } {
  let carry = "";
  const push = (text: string): string => {
    const input = carry + text;
    carry = "";
    let out = "";
    let i = 0;
    while (i < input.length) {
      const code = input.charCodeAt(i);
      if (code === 0x1b) {
        const end = skipEscape(input, i);
        if (end === -1) {
          carry = input.slice(i);
          return out;
        }
        i = end;
        continue;
      }
      if (code === 0x0d) {
        // Fold CRLF and lone CR to LF so progress-bar rewrites become separate lines.
        if (i === input.length - 1) {
          carry = "\r";
          return out;
        }
        if (input[i + 1] === "\n") {
          i += 1;
          continue;
        }
        out += "\n";
        i += 1;
        continue;
      }
      if (isStrippableControlChar(code)) {
        i += 1;
        continue;
      }
      out += input[i];
      i += 1;
    }
    return out;
  };
  const flush = (): string => {
    // A carried CR at EOF becomes a final newline; a carried incomplete escape sequence is
    // dropped — it was a control sequence, never printable content.
    const rest = carry === "\r" ? "\n" : "";
    carry = "";
    return rest;
  };
  return { push, flush };
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
  const scrubber = createControlSequenceScrubber();
  let combined = "";
  const onAbort = (): void => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const emit = (text: string): void => {
    if (!text) return;
    combined += text;
    onChunk?.({ stream: streamName, text });
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (!text) continue;
      emit(scrubber.push(text));
    }
    emit(scrubber.push(decoder.decode()));
    emit(scrubber.flush());
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
