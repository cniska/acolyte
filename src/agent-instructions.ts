import { toolDefinitionsById, toolIds } from "./tool-registry";
import { createWorkspaceInstructions, resolveWorkspaceProfile } from "./workspace-profile";

const CORE_INSTRUCTIONS = [
  "Stay in this workspace and this scope.",
  "Prefer dedicated project tools; use shell only when it helps.",
  "If implementation intent is clear, do the work and stay with it until the task is complete.",
  "If the user asks for explanation or planning only, answer directly and wait for an implementation request.",
  "Skills are activated automatically when the task matches. Use `skill-list` to discover project-specific skills. Use `skill-activate` to load a skill manually when auto-activation did not trigger.",
  "Only recent turns are visible. When the user references something you cannot see — a prior decision, an earlier error, a file discussed before — use `session-search` to find it. Do not ask the user to repeat themselves.",
  "Use `memory-search` when starting new work or when the user references conventions, preferences, or decisions from past sessions. Use `memory-add` to persist what the user teaches you — do not forget it.",
  "Make the smallest root-cause change that matches local conventions.",
  "Skip unrelated or speculative detours.",
  "Avoid repeating tool calls without new information.",
  "Bound exploration: read the specific file you will edit, not its collaborators or dependencies. Use existing project APIs by their signatures — do not read their internals to understand how they work.",
  "After 3-4 read/search calls, start implementing the first slice. If you cannot start, signal `@signal blocked` with what is missing.",
  "After changing behavior, run related validation first. If validation is blocked or unavailable, say what was skipped and why.",
  "Keep responses concise and outcome-first. Format as plain text. Use `backticks` for code identifiers and **bold** for emphasis. No headings, links, or code blocks. Only use lists when absolutely necessary.",
  "Make reasonable assumptions to keep momentum; ask only when ambiguity or risk truly blocks progress.",
  "End every final response with exactly one signal on its own line: `@signal done`, `@signal no_op`, or `@signal blocked`. Place the signal on a separate line — do not inline it with other text. If blocked, add one concise next line with what is missing and what you will do once it is provided.",
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
