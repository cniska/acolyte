import { relative } from "node:path";
import { wrapAssistantContent } from "./chat-content";
import { formatCompactNumber } from "./chat-format";
import { t, tDynamic } from "./i18n";
import { formatToolOutput, type ToolOutputPart } from "./tool-output-content";
import { toolLabelKey } from "./tool-output-format";
import { CLI_TOOL_OUTPUT_LIMITS } from "./tool-policy";
import { printDim, printToolHeader } from "./ui";

export function displayPath(pathInput: string): string {
  const rel = relative(process.cwd(), pathInput);
  if (!rel || rel.startsWith("..")) return pathInput;
  return rel;
}

export function printIndentedDim(content: string): void {
  for (const line of content.split("\n")) {
    printDim(line.length > 0 ? `  ${line}` : "");
  }
}

export function printToolResult(toolId: string, raw: string, detail?: string): void {
  const labelKey = toolLabelKey(toolId);
  const content = formatForTool(toolId, raw);
  const items: ToolOutputPart[] = [{ kind: "tool-header", labelKey, detail }];
  if (content.length === 0) {
    items.push({ kind: "no-output" });
  } else {
    for (const line of content.split("\n")) {
      const trimmed = line.trimEnd();
      if (trimmed.length > 0) items.push({ kind: "text", text: trimmed });
    }
  }
  const rendered = formatToolOutput(items);
  const lines = rendered.split("\n");
  if (lines[0]) printToolHeader(tDynamic(labelKey), detail);
  for (const line of lines.slice(1)) {
    printDim(line);
  }
}

export function clampLines(lines: string[], maxLines: number, overflowTolerance = 4): string[] {
  if (lines.length <= maxLines + overflowTolerance) return lines;
  return [...lines.slice(0, maxLines - 1), `… +${t("unit.line", { count: lines.length - (maxLines - 1) })}`];
}

export function formatFindOutput(raw: string): string {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return t("tool.content.no_matches");
  return clampLines(lines, CLI_TOOL_OUTPUT_LIMITS.files).join("\n");
}

export function formatSearchOutput(raw: string): string {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0 || (lines.length === 1 && lines[0].toLowerCase().startsWith("no matches")))
    return t("tool.content.no_matches");
  return clampLines(lines, CLI_TOOL_OUTPUT_LIMITS.files).join("\n");
}

export function formatReadOutput(raw: string): string {
  const lines = raw.split("\n");
  const normalized = [...lines];
  if (normalized[0]?.startsWith("File: ")) {
    const rawPath = normalized[0].slice("File: ".length).trim();
    normalized[0] = `File: ${displayPath(rawPath)}`;
  }
  return clampLines(normalized, CLI_TOOL_OUTPUT_LIMITS.read).join("\n");
}

export function formatDiffOutput(raw: string): string {
  const lines = raw.split("\n").filter((line) => line.length > 0);
  return clampLines(lines, CLI_TOOL_OUTPUT_LIMITS.diff).join("\n");
}

export function formatGitStatusOutput(raw: string): string {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return t("tool.content.working_tree_clean");
  return clampLines(lines, CLI_TOOL_OUTPUT_LIMITS.status).join("\n");
}

export function formatRunOutput(raw: string): string {
  const lines = raw.split("\n");
  if (lines.length === 0) return t("tool.content.no_output");

  const exitCode = Number.parseInt((lines[0] ?? "").replace("exit_code=", "").trim(), 10);
  const stdoutIdx = lines.findIndex((line) => line.trim() === "stdout:");
  const stderrIdx = lines.findIndex((line) => line.trim() === "stderr:");
  const out: string[] = [];

  const section = (name: "stdout:" | "stderr:", start: number, end: number): void => {
    if (start < 0) return;
    let payload = lines.slice(start + 1, end).filter((line) => line.trim().length > 0);
    if (name === "stderr:" && exitCode === 0 && stdoutIdx >= 0) payload = [];
    if (payload.length === 0) return;
    out.push(...clampLines(payload, CLI_TOOL_OUTPUT_LIMITS.run));
  };

  const nextAfterStdout = stderrIdx >= 0 ? stderrIdx : lines.length;
  section("stdout:", stdoutIdx, nextAfterStdout);
  section("stderr:", stderrIdx, lines.length);

  if (out.length === 0) return t("tool.content.no_output");
  return out.join("\n");
}

const TOOL_FORMATTERS: Record<string, (raw: string) => string> = {
  "file-find": formatFindOutput,
  "file-search": formatSearchOutput,
  "file-read": formatReadOutput,
  "code-scan": formatReadOutput,
  "git-diff": formatDiffOutput,
  "file-edit": formatDiffOutput,
  "code-edit": formatDiffOutput,
  "file-create": formatDiffOutput,
  "shell-run": formatRunOutput,
  "git-status": formatGitStatusOutput,
};

export function formatForTool(toolId: string, raw: string): string {
  return (TOOL_FORMATTERS[toolId] ?? formatReadOutput)(raw);
}

export function formatRunSummary(
  label: string,
  tokenUsage: { usage: { inputTokens: number; outputTokens: number; totalTokens: number }; modelCalls?: number }[],
  durationMs: number,
): string | null {
  const totals = tokenUsage.reduce(
    (acc, e) => ({
      input: acc.input + e.usage.inputTokens,
      output: acc.output + e.usage.outputTokens,
      total: acc.total + e.usage.totalTokens,
      modelCalls: acc.modelCalls + (e.modelCalls ?? 1),
    }),
    { input: 0, output: 0, total: 0, modelCalls: 0 },
  );
  if (totals.total === 0) return null;
  const durationSec = (durationMs / 1000).toFixed(1);
  return `${label}: ${durationSec}s, ${formatCompactNumber(totals.total)} tokens (input ${formatCompactNumber(totals.input)}, output ${formatCompactNumber(totals.output)}), ${t("unit.call", { count: totals.modelCalls })}`;
}

export function formatAgentReplyOutput(content: string, wrapWidth = 100): string {
  const wrapped = wrapAssistantContent(content, wrapWidth);
  const lines = wrapped.split("\n");
  if (lines.length === 0) return "•";
  return lines
    .map((line, index) => {
      if (index === 0) return line.length > 0 ? `• ${line}` : "•";
      return line.length > 0 ? `  ${line}` : "";
    })
    .join("\n");
}
