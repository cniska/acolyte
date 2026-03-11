import type { AgentMode } from "./agent-contract";
import { agentModes } from "./agent-modes";
import { toolDefinitionsById } from "./tool-registry";
import { detectLineWidth } from "./tool-utils";

const BASE_INSTRUCTIONS = [
  "Before taking action (tool call, command, or edit), write exactly one sentence stating what you will do next.",
  "Then execute directly; avoid extra process narration.",
  "Keep tool calls and file changes within the current workspace and the requested scope.",
  "Prefer dedicated project tools; use shell only when no dedicated tool exists.",
  "Keep responses concise and outcome-first; expand only when asked.",
  "Make reasonable assumptions to keep momentum; ask only when blocked by ambiguity or risk.",
  "When finished, state the outcome in one sentence. Do not recap steps taken or list what was changed.",
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
