import { z } from "zod";
import { compactDetail } from "./compact-text";
import { parseExitCode, runShellCommand } from "./shell-ops";
import { createTool, type ToolkitDeps, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { compactToolOutput } from "./tool-output";
import { emitParts, shellHeadTailParts } from "./tool-output-format";
import { formatWorkspaceCommand, resolveCommandFiles } from "./workspace-profile";

function createRunTestsTool(deps: ToolkitDeps, input: ToolkitInput) {
  const { session, onOutput } = input;

  return createTool({
    id: "test-run",
    toolkit: "test",
    labelKey: "tool.label.test_run",
    category: "execute",
    description:
      "Run the project's test runner against specific files. The test command is auto-detected from the workspace.",
    instruction:
      "Use `test-run` to validate touched behavior. Create or update related tests first when behavior changes. Start with the narrowest related tests, then widen scope only when failures suggest broader impact or the user asks. Do not chase unrelated failures.",
    inputSchema: z.object({
      files: z.array(z.string().min(1)).min(1),
      timeoutMs: z.number().int().min(500).max(120000).optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("test-run"),
      command: z.string(),
      exitCode: z.number().int().optional(),
      output: z.string(),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(session, "test-run", toolCallId, toolInput, async (callId) => {
        const profile = session.workspaceProfile;
        const testCommand = profile?.testCommand;
        if (!testCommand) {
          return { kind: "test-run" as const, command: "", exitCode: 1, output: "No test command detected." };
        }

        const resolved = resolveCommandFiles(testCommand, toolInput.files);
        const commandSpec = { cmd: resolved.bin, args: [...resolved.args] };
        const command = formatWorkspaceCommand(resolved);
        onOutput({
          toolName: "test-run",
          content: { kind: "tool-header", labelKey: "tool.label.test_run", detail: compactDetail(command) },
          toolCallId: callId,
        });
        const streamed: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
        const rawResult = await runShellCommand(
          input.workspace,
          commandSpec,
          toolInput.timeoutMs ?? 60_000,
          ({ stream, text }) => {
            for (const line of text.split("\n").filter(Boolean)) {
              streamed.push({ stream, text: line });
            }
          },
        );
        const previewParts = shellHeadTailParts(streamed);
        emitParts(previewParts, "test-run", onOutput, callId);

        const result = compactToolOutput(rawResult, deps.outputBudget.run);
        return { kind: "test-run" as const, command, exitCode: parseExitCode(rawResult), output: result };
      });
    },
  });
}

export function createTestToolkit(deps: ToolkitDeps, input: ToolkitInput) {
  return {
    runTests: createRunTestsTool(deps, input),
  };
}
