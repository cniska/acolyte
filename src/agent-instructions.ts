import type { AgentMode } from "./agent-contract";
import { agentModes } from "./agent-modes";
import { toolDefinitionsById } from "./tool-registry";
import { detectLineWidth } from "./tool-utils";

const BASE_INSTRUCTIONS = [
  "Before taking action (tool call, command, or edit), write exactly one sentence stating what you will do next.",
  "Then execute directly; avoid extra process narration.",
  "Execute tool calls immediately in the same turn — do not describe what you will do without doing it.",
  "Keep tool calls and file changes within the current workspace and the requested scope.",
  "Prefer dedicated project tools; use shell only when no dedicated tool exists.",
  "Prefer targeted, surgical edits. Preserve unrelated content and surrounding structure, and change only the minimal lines needed.",
  "Do exactly the requested change. Do not add opportunistic comments, refactors, cleanup, or extra edge-case handling unless the request or concrete evidence requires it.",
  "Preserve local conventions in the file you are editing. Match nearby style and path forms instead of inventing a new one.",
  "When fixing an existing path or link, keep the file's local relative/absolute reference style unless the user explicitly asked to normalize it.",
  "Keep responses concise and outcome-first; expand only when asked.",
  "Never summarize, recap, or list what you did. The user can see your actions directly.",
  "Make reasonable assumptions to keep momentum; ask only when blocked by ambiguity or risk.",
  "When lint or format checks fail, run the project auto-fix command (if available) before attempting manual repairs.",
  "When the task is complete, already needs no changes, or you are blocked, end the final response with exactly one control line on its own line: `@signal done`, `@signal no_op`, or `@signal blocked`.",
];

export function createModeInstructions(mode: AgentMode, workspace?: string): string {
  const { tools, preamble } = agentModes[mode];
  const lines: string[] = preamble.map((p) => `- ${p}`);
  for (const toolId of tools) {
    const tool = toolDefinitionsById[toolId];
    if (tool?.instruction) lines.push(`- ${tool.instruction}`);
  }
  if (workspace && mode === "work") {
    const lineWidth = detectLineWidth(workspace);
    if (lineWidth) lines.push(`- Keep lines under ${lineWidth} characters.`);
  }
  return lines.join("\n");
}

export function createInstructions(soulPrompt: string, mode: AgentMode, workspace?: string): string {
  const baseInstructions = BASE_INSTRUCTIONS.map((p) => `- ${p}`).join("\n");
  const modeInstructions = createModeInstructions(mode, workspace);
  return `${soulPrompt}\n\n${baseInstructions}\n\n${modeInstructions}`;
}
