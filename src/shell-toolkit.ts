import { z } from "zod";
import { ERROR_KINDS, LIFECYCLE_ERROR_CODES } from "./error-contract";
import { formatShellCommand, parseExitCode, runShellCommand } from "./shell-ops";
import { createTool, type ToolkitInput } from "./tool-contract";
import { createToolError } from "./tool-error";
import { runTool } from "./tool-execution";
import { emitParts, shellHeadTailParts } from "./tool-output-format";
import { LIVE_TAIL_ROWS } from "./tool-output-render";

/** The shell tool owns the command's deadline: it kills the process and returns what the
 *  command printed before the kill. `runTool`'s timeout is a backstop for a tool that fails
 *  to return at all, so it must fire strictly later — firing first discards that output and
 *  leaves the process streaming into a call that has already failed. */
const SHELL_TIMEOUT_MS = 60_000;
const BACKSTOP_GRACE_MS = 5_000;
/** A command can print faster than anything downstream can consume. Only the newest rows are
 *  ever displayed, so batching on this interval and keeping the tail bounds the event rate
 *  without changing what the user sees. */
const LIVE_FLUSH_MS = 50;

function createRunCommandTool(input: ToolkitInput) {
  return createTool({
    id: "shell-run",
    toolkit: "shell",
    category: "execute",
    description:
      "Run a command in the repository and capture stdout/stderr. Give a binary in `cmd` and its arguments in `args`: there is no shell, so operators, pipes, and redirection do not work. Never use a command as a fallback for file discovery, reading, or editing when a dedicated tool exists.",
    inputSchema: z.object({
      cmd: z.string().min(1),
      args: z.array(z.string()).optional(),
      timeoutMs: z.number().int().min(500).max(120000).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("shell-run"),
      command: z.string().min(1),
      exitCode: z.number().int().optional(),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      const timeoutMs = toolInput.timeoutMs ?? SHELL_TIMEOUT_MS;
      return runTool(
        input.session,
        "shell-run",
        toolCallId,
        toolInput,
        async (callId) => {
          const displayCommand = formatShellCommand({ cmd: toolInput.cmd, args: toolInput.args ?? [] });
          input.onOutput({
            toolName: "shell-run",
            content: {
              kind: "tool-header",
              labelKey: "tool.label.shell_run",
              detail: displayCommand,
            },
            toolCallId: callId,
          });
          const streamed: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
          let stdoutBuffer = "";
          let stderrBuffer = "";
          // Emitted while the command runs so a long build shows progress instead of a bare
          // header. The settled preview below replaces them; a run that times out keeps them.
          let pendingLive: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
          let flushTimer: ReturnType<typeof setTimeout> | null = null;
          const flushLive = (): void => {
            flushTimer = null;
            const rows = pendingLive.slice(-LIVE_TAIL_ROWS);
            pendingLive = [];
            for (const row of rows) {
              input.onOutput({
                toolName: "shell-run",
                content: { kind: "shell-output", stream: row.stream, text: row.text },
                toolCallId: callId,
                transient: true,
              });
            }
          };
          const stopLive = (): void => {
            if (flushTimer) clearTimeout(flushTimer);
            flushTimer = null;
            pendingLive = [];
          };
          const recordLine = (stream: "stdout" | "stderr", text: string): void => {
            streamed.push({ stream, text });
            pendingLive.push({ stream, text });
            if (!flushTimer) flushTimer = setTimeout(flushLive, LIVE_FLUSH_MS);
          };
          const flushBufferLines = (stream: "stdout" | "stderr"): void => {
            const source = stream === "stdout" ? stdoutBuffer : stderrBuffer;
            let remaining = source;
            while (true) {
              const newlineIndex = remaining.indexOf("\n");
              if (newlineIndex === -1) break;
              const line = remaining.slice(0, newlineIndex).trimEnd();
              remaining = remaining.slice(newlineIndex + 1);
              if (line.length > 0) recordLine(stream, line);
            }
            if (stream === "stdout") {
              stdoutBuffer = remaining;
            } else {
              stderrBuffer = remaining;
            }
          };
          const { output: rawResult, timedOut } = await runShellCommand(
            input.workspace,
            { cmd: toolInput.cmd, args: toolInput.args ?? [] },
            timeoutMs,
            ({ stream, text }) => {
              if (stream === "stdout") {
                stdoutBuffer += text;
              } else {
                stderrBuffer += text;
              }
              flushBufferLines(stream);
            },
          );
          stopLive();
          const flushRemainder = (stream: "stdout" | "stderr"): void => {
            const remainder = (stream === "stdout" ? stdoutBuffer : stderrBuffer).trimEnd();
            if (remainder.length > 0) recordLine(stream, remainder);
            if (stream === "stdout") {
              stdoutBuffer = "";
            } else {
              stderrBuffer = "";
            }
          };
          flushRemainder("stdout");
          flushRemainder("stderr");
          if (timedOut) {
            // Killing the process is the point; discarding what it printed first is not. The
            // live rows stay on screen because no settled part replaces them.
            throw createToolError(
              LIFECYCLE_ERROR_CODES.timeout,
              `shell-run timed out after ${timeoutMs}ms\n${rawResult}`,
              ERROR_KINDS.timeout,
            );
          }
          const previewParts = shellHeadTailParts(streamed);
          emitParts(previewParts, "shell-run", input.onOutput, callId);
          return {
            kind: "shell-run" as const,
            command: displayCommand,
            exitCode: parseExitCode(rawResult),
            output: rawResult,
          };
        },
        { timeoutMs: timeoutMs + BACKSTOP_GRACE_MS },
      );
    },
  });
}

export function createShellToolkit(input: ToolkitInput) {
  return {
    runCommand: createRunCommandTool(input),
  };
}
