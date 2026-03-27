import { z } from "zod";
import { compactDetail } from "./compact-text";
import { parseExitCode, runShellCommand } from "./shell-ops";
import { createTool, type ToolkitDeps, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import { emitShellHeadTail } from "./tool-output-format";
import { formatWorkspaceCommand } from "./workspace-profile";

function createRunTestsTool(deps: ToolkitDeps, input: ToolkitInput) {
  const { session, onOutput } = input;

  return createTool({
    id: "run-tests",
    labelKey: "tool.label.run_tests",
    category: "execute",
    permissions: ["execute"],
    description:
      "Run the project's test runner against specific files. The test command is auto-detected from the workspace.",
    instruction:
      "Use `run-tests` to validate changes by running tests for the files you modified. Always scope to specific test files rather than running the full suite.",
    inputSchema: z.object({
      files: z.array(z.string().min(1)).min(1),
      timeoutMs: z.number().int().min(500).max(120000).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("run-tests"),
      command: z.string(),
      exitCode: z.number().int().optional(),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      const profile = session.workspaceProfile;
      const testCommand = profile?.testCommand;
      if (!testCommand) {
        return { kind: "run-tests" as const, command: "", exitCode: 1, output: "No test command detected." };
      }

      const resolvedArgs = testCommand.args.flatMap((arg) => (arg === "$FILES" ? toolInput.files : [arg]));
      const command = formatWorkspaceCommand({ bin: testCommand.bin, args: resolvedArgs });

      return runTool(session, "run-tests", toolCallId, toolInput, async (callId) => {
        onOutput({
          toolName: "run-tests",
          content: { kind: "tool-header", labelKey: "tool.label.run_tests", detail: compactDetail(command) },
          toolCallId: callId,
        });
        const streamed: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
        const rawResult = await runShellCommand(
          input.workspace,
          command,
          toolInput.timeoutMs ?? 60_000,
          ({ stream, text }) => {
            for (const line of text.split("\n").filter(Boolean)) {
              streamed.push({ stream, text: line });
            }
          },
        );
        emitShellHeadTail("run-tests", streamed, onOutput, callId);

        const result = compactToolOutput(rawResult, deps.outputBudget.run);
        return { kind: "run-tests" as const, command, exitCode: parseExitCode(rawResult), output: result };
      });
    },
  });
}

export function createTestToolkit(deps: ToolkitDeps, input: ToolkitInput) {
  return {
    runTests: createRunTestsTool(deps, input),
  };
}
