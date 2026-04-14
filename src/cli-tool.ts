import { resolve } from "node:path";
import { printToolResult } from "./cli-format";
import { t } from "./i18n";
import { toolsForAgent } from "./tool-registry";
import { resolveWorkspaceProfile } from "./workspace-profile";

type ToolModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  printError: (message: string) => void;
  commandHelp: (name: string) => void;
};

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function coerceInput(toolId: string, rest: string[]): unknown {
  if (rest.length === 0) return {};
  if (rest.length === 1) {
    const parsed = tryParseJson(rest[0]);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  }
  const joined = rest.join(" ");
  if (toolId === "shell-run") return { cmd: rest[0], args: rest.slice(1) };
  if (toolId === "file-find") return { patterns: [joined] };
  if (toolId === "file-search") return { patterns: [joined] };
  if (toolId === "file-read") return { paths: [{ path: joined }] };
  if (toolId === "test-run") return { files: rest };
  return { command: joined };
}

function resultToString(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "output" in result) return String((result as { output: string }).output);
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

  const workspace = resolve(process.cwd());
  const { tools, session } = toolsForAgent({ workspace });
  session.workspaceProfile = resolveWorkspaceProfile(workspace);

  const toolMap = tools as Record<
    string,
    {
      id: string;
      execute: (input: unknown, callId: string) => Promise<unknown>;
    }
  >;
  const tool = Object.values(toolMap).find((entry) => entry.id === toolId);
  if (!tool) {
    printError(t("cli.tool.usage"));
    process.exitCode = 1;
    return;
  }

  try {
    // Bypass runTool intentionally — CLI tool invocations skip budget checks and cache for direct debugging.
    const rawInput = coerceInput(toolId, rest);
    const result = await tool.execute(rawInput, `cli_${toolId}`);
    const detail = rest.join(" ").slice(0, 60) || undefined;
    printToolResult(toolId, resultToString(result), detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : t("cli.tool.failed");
    printError(message);
    process.exitCode = 1;
  }
}
