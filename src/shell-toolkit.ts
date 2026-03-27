import { z } from "zod";
import { compactDetail } from "./compact-text";
import { parseExitCode, runShellCommand } from "./shell-ops";
import { createTool, type ToolkitDeps, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import { emitShellHeadTail } from "./tool-output-format";

function createRunCommandTool(deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "run-command",
    labelKey: "tool.label.run_command",
    category: "execute",
    permissions: ["execute"],
    description:
      "Run a shell command in the repository and capture stdout/stderr. Never use shell commands as fallbacks for file discovery/reading/editing when dedicated tools are available.",
    instruction:
      "Use `run-command` for known repository commands such as documented build/test/verify steps, or when the user explicitly asked you to run a command. Do not use it for file read/search/edit fallbacks (`cat`, `head`, `tail`, `nl`, `ls`, `grep`, `sed`, `find`, `rg`, `wc`) — use `read-file`, `search-files`, `find-files`, `edit-file`, or `edit-code`. For explicit named-file bounded tasks, do not run commands after the edit just to double-check the result unless the user asked for verification.",
    inputSchema: z.object({
      command: z.string().min(1),
      timeoutMs: z.number().int().min(500).max(120000).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("run-command"),
      command: z.string().min(1),
      exitCode: z.number().int().optional(),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(
        input.session,
        "run-command",
        toolCallId,
        toolInput,
        async (callId) => {
          input.onOutput({
            toolName: "run-command",
            content: {
              kind: "tool-header",
              labelKey: "tool.label.run_command",
              detail: compactDetail(toolInput.command),
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
            toolInput.command,
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
          emitShellHeadTail("run-command", streamed, input.onOutput, callId);
          const result = compactToolOutput(rawResult, deps.outputBudget.run);
          return {
            kind: "run-command",
            command: toolInput.command,
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
