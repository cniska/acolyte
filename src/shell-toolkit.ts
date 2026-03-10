import { z } from "zod";
import { appConfig } from "./app-config";
import { compactDetail } from "./compact-text";
import { t } from "./i18n";
import { runShellCommand } from "./shell-ops";
import { createTool, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import { TOOL_OUTPUT_RUN_MAX_ROWS } from "./tool-output-format";

function createRunCommandTool(input: ToolkitInput) {
  const { workspace, session, onOutput } = input;

  const parseExitCode = (result: string): number | undefined => {
    const match = result.match(/^exit_code=(\d+)$/m);
    if (!match?.[1]) return undefined;
    const value = Number.parseInt(match[1], 10);
    return Number.isNaN(value) ? undefined : value;
  };

  return createTool({
    id: "run-command",
    label: t("tool.label.run"),
    category: "execute",
    permissions: ["execute"],
    description:
      "Run a shell command in the repository and capture stdout/stderr. Never use shell commands as fallbacks for file discovery/reading/editing when dedicated tools are available.",
    instruction:
      "Use `run-command` to run verification after edits and to execute build/test commands. Do not use it for file read/search/edit fallbacks (`cat`, `head`, `tail`, `nl`, `ls`, `grep`, `sed`, `find`, `rg`, `wc`) — use `read-file`, `search-files`, `find-files`, `edit-file`, or `edit-code`.",
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
    execute: async (toolInput) => {
      return runTool(session, "run-command", toolInput, async (toolCallId) => {
        onOutput({
          toolName: "run-command",
          content: { kind: "tool-header", label: t("tool.label.run"), detail: compactDetail(toolInput.command) },
          toolCallId,
        });
        const headRows = 2;
        const tailRows = 2;
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
          workspace,
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
        const emitLine = (entry: { stream: "stdout" | "stderr"; text: string }): void => {
          onOutput({
            toolName: "run-command",
            content: { kind: "command-output", stream: entry.stream, text: entry.text },
            toolCallId,
          });
        };
        if (streamed.length > headRows + tailRows) {
          const omitted = streamed.length - (headRows + tailRows);
          for (const line of streamed.slice(0, headRows)) emitLine(line);
          onOutput({
            toolName: "run-command",
            content: { kind: "truncated", count: omitted, unit: "lines" },
            toolCallId,
          });
          for (const line of streamed.slice(streamed.length - tailRows)) emitLine(line);
        } else if (streamed.length === 0) {
          onOutput({ toolName: "run-command", content: { kind: "no-output" }, toolCallId });
        } else {
          for (const line of streamed.slice(0, TOOL_OUTPUT_RUN_MAX_ROWS)) emitLine(line);
        }
        const result = compactToolOutput(rawResult, appConfig.agent.toolOutputBudget.run);
        return { kind: "run-command", command: toolInput.command, exitCode: parseExitCode(rawResult), output: result };
      });
    },
  });
}

export function createShellToolkit(input: ToolkitInput) {
  return {
    runCommand: createRunCommandTool(input),
  };
}
