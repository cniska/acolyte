import { isAllowedPath } from "./tool-utils";

const BLOCKED_SHELL_TOKENS = ["rm -rf /", "shutdown", "reboot", "mkfs", "dd if="];

type ShellChunk = {
  stream: "stdout" | "stderr";
  text: string;
};

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
  if (/(?:^|[\s"'`])~[a-zA-Z0-9_]*\//.test(command))
    throw new Error("Command references home path outside allowed roots");
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
  command: string,
  timeoutMs = 60_000,
  onChunk?: (chunk: ShellChunk) => void,
): Promise<string> {
  const trimmed = command.trim();
  if (!trimmed) throw new Error("Command cannot be empty");
  const lower = trimmed.toLowerCase();
  if (BLOCKED_SHELL_TOKENS.some((token) => lower.includes(token))) throw new Error("Command contains blocked token");
  ensureCommandScopedToWorkspace(trimmed, workspace);

  const startedAt = Date.now();
  const controller = new AbortController();
  const proc = Bun.spawn({
    cmd: ["bash", "-lc", trimmed],
    cwd: workspace,
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
