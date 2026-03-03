import { type AgentMode, agentModes } from "./agent-modes";
import { toolMeta } from "./tool-meta";
import { isToolName } from "./tool-names";
import { detectLineWidth } from "./tools";

const BASE_INSTRUCTIONS = [
  "- Execute the task directly; avoid meta narration about your process.",
  "- Prefer dedicated project tools; use shell only when no dedicated tool exists.",
  "- Keep responses concise and outcome-first; expand only when asked.",
  "- Make reasonable assumptions to keep momentum; ask only when blocked by ambiguity or risk.",
  "- Stop once the user's request is completed and verified.",
].join("\n");

export function createModeInstructions(mode: AgentMode, workspace?: string): string {
  const { tools, preamble } = agentModes[mode];
  const lines: string[] = preamble.map((p) => `- ${p}`);
  for (const toolId of tools) {
    if (!isToolName(toolId)) continue;
    const meta = toolMeta[toolId];
    if (meta?.instruction) lines.push(`- ${meta.instruction}`);
  }
  if (workspace && mode === "work") {
    const lineWidth = detectLineWidth(workspace);
    if (lineWidth) lines.push(`- Keep lines under ${lineWidth} characters.`);
  }
  return lines.join("\n");
}

export function createInstructions(soulPrompt: string, mode: AgentMode, workspace?: string): string {
  const modeInstructions = createModeInstructions(mode, workspace);
  return `${soulPrompt}\n\n${BASE_INSTRUCTIONS}\n\n${modeInstructions}`;
}
