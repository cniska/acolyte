import { z } from "zod";
import { formatShellCommand, parseExitCode, runShellCommand } from "./shell-ops";
import { createTool, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { emitParts, shellHeadTailParts } from "./tool-output-format";

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
          let running = true;
          // Emitted while the command runs so a long build shows progress instead of a bare
          // header. The settled preview below replaces them; a run that times out keeps them.
          const recordLine = (stream: "stdout" | "stderr", text: string): void => {
            streamed.push({ stream, text });
            if (running) {
              input.onOutput({
                toolName: "shell-run",
                content: { kind: "shell-output", stream, text },
                toolCallId: callId,
                transient: true,
              });
            }
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
          const rawResult = await runShellCommand(
            input.workspace,
            { cmd: toolInput.cmd, args: toolInput.args ?? [] },
            toolInput.timeoutMs ?? 60_000,
            ({ stream, text }) => {
              if (stream === "stdout") {
                stdoutBuffer += text;
              } else {
                stderrBuffer += text;
              }
              flushBufferLines(stream);
            },
          );
          running = false;
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
          const previewParts = shellHeadTailParts(streamed);
          emitParts(previewParts, "shell-run", input.onOutput, callId);
          return {
            kind: "shell-run" as const,
            command: displayCommand,
            exitCode: parseExitCode(rawResult),
            output: rawResult,
          };
        },
        { timeoutMs: toolInput.timeoutMs },
      );
    },
  });
}

export function createShellToolkit(input: ToolkitInput) {
  return {
    runCommand: createRunCommandTool(input),
  };
}
