import { z } from "zod";
import { compactDetail } from "./compact-text";
import { formatShellCommand, parseExitCode, runShellCommand } from "./shell-ops";
import { createTool, type ToolkitDeps, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import { emitParts, shellHeadTailParts } from "./tool-output-format";

function createRunCommandTool(deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "shell-run",
    toolkit: "shell",
    labelKey: "tool.label.shell_run",
    category: "execute",
    description:
      "Run a command in the repository and capture stdout/stderr without shell evaluation. Never use shell commands as fallbacks for file discovery/reading/editing when dedicated tools are available.",
    instruction:
      "Use `shell-run` for known repository commands such as documented build/test/verify steps, or when the user explicitly asked you to run a command. Provide a binary in `cmd` and arguments in `args`; shell operators/pipes/redirections are not supported. Do not use it for file read/search/edit fallbacks (`cat`, `head`, `tail`, `nl`, `ls`, `grep`, `sed`, `find`, `rg`, `wc`) — use `file-read`, `file-search`, `file-find`, `file-edit`, or `code-edit`. For explicit named-file bounded tasks, do not run commands after the edit just to double-check the result unless the user asked for verification.",
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
              detail: compactDetail(displayCommand),
            },
            toolCallId: callId,
          });
          const streamed: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
          let stdoutBuffer = "";
          let stderrBuffer = "";
          const recordLine = (stream: "stdout" | "stderr", text: string): void => {
            streamed.push({ stream, text });
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
          const result = compactToolOutput(rawResult, deps.outputBudget.run);
          return {
            kind: "shell-run",
            command: displayCommand,
            exitCode: parseExitCode(rawResult),
            output: result,
          };
        },
        { timeoutMs: toolInput.timeoutMs },
      );
    },
  });
}

export function createShellToolkit(deps: ToolkitDeps, input: ToolkitInput) {
  return {
    runCommand: createRunCommandTool(deps, input),
  };
}
