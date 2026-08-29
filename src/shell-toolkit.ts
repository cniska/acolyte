import { z } from "zod";
import { ERROR_KINDS, LIFECYCLE_ERROR_CODES } from "./error-contract";
import { formatShellCommand, parseExitCode, runShellCommand } from "./shell-ops";
import { createTool, type ToolkitInput } from "./tool-contract";
import { createToolError } from "./tool-error";
import { runTool } from "./tool-execution";
import { createProcessOutput } from "./tool-live-output";
import { emitParts, shellTailParts } from "./tool-output-format";
import { OUTPUT_WINDOW_ROWS } from "./tool-policy";

/** The shell tool owns the command's deadline: it kills the process and returns what the
 *  command printed before the kill. `runTool`'s timeout is a backstop for a tool that fails
 *  to return at all, so it must fire strictly later — firing first discards that output and
 *  leaves the process streaming into a call that has already failed. */
const SHELL_TIMEOUT_MS = 60_000;
const BACKSTOP_GRACE_MS = 5_000;
function createRunCommandTool(input: ToolkitInput) {
  return createTool({
    id: "shell-run",
    toolkit: "shell",
    category: "execute",
    description:
      "Run a command in the repository and capture stdout/stderr. Give a binary in `cmd` and its arguments in `args`: there is no shell, so operators, pipes, and redirection do not work.",
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
          // Emitted while the command runs so a long build shows progress instead of a bare
          // header. The preview below replaces them; a run that times out keeps them.
          const live = createProcessOutput({
            toolName: "shell-run",
            toolCallId: callId,
            onOutput: input.onOutput,
          });
          // A rejected process leaves a batched flush pending, which would put a live row on a call
          // that already failed.
          const { output: rawResult, timedOut } = await runShellCommand(
            input.workspace,
            { cmd: toolInput.cmd, args: toolInput.args ?? [] },
            timeoutMs,
            ({ stream, text }) => live.chunk(stream, text),
          ).catch((error) => {
            live.finish();
            throw error;
          });
          const streamed = live.finish();
          if (timedOut) {
            // Killing the process is the point; discarding what it printed first is not. The
            // live rows stay on screen because no preview part replaces them.
            throw createToolError(
              LIFECYCLE_ERROR_CODES.timeout,
              `shell-run timed out after ${timeoutMs}ms\n${rawResult}`,
              ERROR_KINDS.timeout,
            );
          }
          const previewParts = shellTailParts(streamed, OUTPUT_WINDOW_ROWS);
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
