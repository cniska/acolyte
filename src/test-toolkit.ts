import { z } from "zod";
import { parseExitCode, runShellCommand } from "./shell-ops";
import { createTool, type ToolkitInput } from "./tool-contract";
import { runTool } from "./tool-execution";
import { createProcessOutput } from "./tool-live-output";
import { emitParts, shellTailParts } from "./tool-output-format";
import { OUTPUT_WINDOW_ROWS } from "./tool-policy";
import { formatWorkspaceCommand, resolveCommandFiles } from "./workspace-profile";

function createRunTestsTool(input: ToolkitInput) {
  const { session, onOutput } = input;

  return createTool({
    id: "test-run",
    toolkit: "test",
    category: "execute",
    description:
      "Run the project's test runner against specific files. The test command is auto-detected from the workspace.",
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
          content: { kind: "tool-header", labelKey: "tool.label.test_run", detail: command },
          toolCallId: callId,
        });
        // A test run is the other long-lived process: show its tail while it runs so a hanging
        // or failing suite is visible before it finishes. The preview below replaces these.
        const live = createProcessOutput({ toolName: "test-run", toolCallId: callId, onOutput });
        // A rejected process leaves a batched flush pending, which would put a live row on a call
        // that already failed.
        const { output: rawResult } = await runShellCommand(
          input.workspace,
          commandSpec,
          toolInput.timeoutMs ?? 60_000,
          ({ stream, text }) => live.chunk(stream, text),
        ).catch((error) => {
          live.finish();
          throw error;
        });
        const streamed = live.finish();
        const previewParts = shellTailParts(streamed, OUTPUT_WINDOW_ROWS);
        emitParts(previewParts, "test-run", onOutput, callId);

        return { kind: "test-run" as const, command, exitCode: parseExitCode(rawResult), output: rawResult };
      });
    },
  });
}

export function createTestToolkit(input: ToolkitInput) {
  return {
    runTests: createRunTestsTool(input),
  };
}
