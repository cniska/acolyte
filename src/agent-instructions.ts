import { toolDefinitionsById, toolIds } from "./tool-registry";
import { createWorkspaceInstructions, resolveWorkspaceProfile } from "./workspace-profile";

const CORE_INSTRUCTIONS = [
  "Stay in this workspace and this scope.",
  "Prefer dedicated project tools; use shell only when it helps.",
  "If implementation intent is clear, do the work and stay with it until the task is complete.",
  "If the user asks for explanation or planning only, answer directly and wait for an implementation request.",
  "You have engineering skills. When a task matches a skill, activate it before starting. The skill's workflow is the way you do the work — not optional guidance.",
  "Make the smallest root-cause change that matches local conventions.",
  "Skip unrelated or speculative detours.",
  "Avoid repeating tool calls without new information.",
  "After changing behavior, run related validation first. If validation is blocked or unavailable, say what was skipped and why.",
  "Keep responses concise and outcome-first.",
  "Make reasonable assumptions to keep momentum; ask only when ambiguity or risk truly blocks progress.",
  "End every final response with exactly one signal line: `@signal done`, `@signal no_op`, or `@signal blocked`. If blocked, add one concise next line with what is missing and what you will do once it is provided.",
];

const TOOL_IDS = toolIds();

function createRuntimeInstructions(workspace?: string): string {
  const lines: string[] = [];
  for (const toolId of TOOL_IDS) {
    const tool = toolDefinitionsById[toolId];
    if (tool?.instruction) lines.push(`- ${tool.instruction}`);
  }
  if (workspace) {
    const profile = resolveWorkspaceProfile(workspace);
    for (const line of createWorkspaceInstructions(profile)) lines.push(`- ${line}`);
  }
  return lines.join("\n");
}

export function createInstructions(soulPrompt: string, workspace?: string): string {
  const coreInstructions = CORE_INSTRUCTIONS.map((p) => `- ${p}`).join("\n");
  const runtimeInstructions = createRuntimeInstructions(workspace);
  return `${soulPrompt}\n\n${coreInstructions}\n\n${runtimeInstructions}`;
}
