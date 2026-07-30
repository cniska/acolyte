import { resolve } from "node:path";
import { z } from "zod";
import { printIndentedDim, printToolResult } from "./cli-format";
import { t } from "./i18n";
import type { RunToolResult, ToolDefinition } from "./tool-contract";
import { toolsForAgent } from "./tool-registry";
import { resolveWorkspaceProfile } from "./workspace-profile";

type ToolModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  printError: (message: string) => void;
  commandHelp: (name: string) => void;
};

export type ParsedToolInput = { ok: true; input: Record<string, unknown> } | { ok: false; message: string };

export function parseToolInput(rest: string[]): ParsedToolInput {
  if (rest.length === 0) return { ok: true, input: {} };
  if (rest.length > 1) return { ok: false, message: t("cli.tool.usage") };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rest[0]);
  } catch (error) {
    return { ok: false, message: t("cli.tool.invalid_json", { message: error instanceof Error ? error.message : "" }) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: t("cli.tool.not_object") };
  }
  return { ok: true, input: parsed as Record<string, unknown> };
}

export function formatToolBody(runResult: RunToolResult<unknown>): string {
  const { result } = runResult;
  if (result && typeof result === "object" && "output" in result) {
    const { output } = result as { output: unknown };
    if (typeof output === "string") return output;
  }
  return JSON.stringify(result, null, 2);
}

export async function toolMode(args: string[], deps: ToolModeDeps): Promise<void> {
  const { hasHelpFlag, printError, commandHelp } = deps;
  if (hasHelpFlag(args)) {
    commandHelp("tool");
    return;
  }
  const [toolId, ...rest] = args;
  if (!toolId) {
    printError(t("cli.tool.usage"));
    process.exitCode = 1;
    return;
  }
  const parsedInput = parseToolInput(rest);
  if (!parsedInput.ok) {
    printError(parsedInput.message);
    process.exitCode = 1;
    return;
  }

  const workspace = resolve(process.cwd());
  const { tools, session } = toolsForAgent({ workspace });
  session.workspaceProfile = resolveWorkspaceProfile(workspace);

  const available = Object.values<ToolDefinition>(tools);
  const tool = available.find((entry) => entry.id === toolId);
  if (!tool) {
    printError(`${t("cli.tool.unknown", { tool: toolId })} ${t("cli.tool.usage")}`);
    printIndentedDim(
      available
        .map((entry) => entry.id)
        .sort()
        .join(", "),
    );
    process.exitCode = 1;
    return;
  }

  try {
    const runResult = await tool.execute(parsedInput.input, `cli_${toolId}`);
    const detail = rest.join(" ").slice(0, 60) || undefined;
    printToolResult(toolId, formatToolBody(runResult), detail);
    if (runResult.effectOutput) printIndentedDim(runResult.effectOutput);
  } catch (error) {
    if (error instanceof z.ZodError) {
      printError(`${t("cli.tool.invalid_input", { tool: toolId })}\n${z.prettifyError(error)}`);
    } else {
      printError(error instanceof Error ? error.message : t("cli.tool.failed"));
    }
    process.exitCode = 1;
  }
}
