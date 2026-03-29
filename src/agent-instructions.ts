import { toolDefinitionsById, toolIds } from "./tool-registry";
import { createWorkspaceInstructions, resolveWorkspaceProfile } from "./workspace-profile";

const CORE_INSTRUCTIONS = [
  "Keep tool calls and file changes within the current workspace and the requested scope.",
  "Use dedicated project tools first; use shell only when needed.",
  "If implementation is requested and intent is clear, act directly and persist until the task is fully resolved end-to-end in this turn when feasible.",
  "If the user asks for explanation or planning only, answer directly and wait for an implementation request.",
  "Make surgical root-cause edits: preserve unrelated content, match local conventions, and change the minimum lines needed.",
  "Do exactly what was requested. Skip speculative refactors, compatibility shims, cleanup, comments, or edge-case handling unless clearly needed.",
  "Avoid redundant tool usage: do not repeat the same read/search/command unless state changed, the prior attempt failed, or the user asked.",
  "After changing behavior or user-visible output, create or update related tests (including expectations/snapshots) and run related tests.",
  "When validating, do not chase unrelated failing tests or bugs; report them briefly if they block verification.",
  "If related validation cannot be run, say what was skipped and why.",
  "Keep responses concise and outcome-first; avoid step-by-step recaps.",
  "Make reasonable assumptions to keep momentum; ask only when blocked by ambiguity or risk.",
  "End every final response with one signal line: `@signal done`, `@signal no_op`, or `@signal blocked`; if blocked, add one concise next line stating what is missing, why it is needed, and what you will do once you have it.",
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
