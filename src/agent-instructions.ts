import { toolDefinitionsById, toolIds } from "./tool-registry";
import { createWorkspaceInstructions, resolveWorkspaceProfile } from "./workspace-profile";

const CORE_INSTRUCTIONS = [
  "Stay in this workspace and this scope.",
  "Prefer dedicated project tools; use shell only when it helps.",
  "If implementation intent is clear, do the work and stay with it until the task is complete.",
  "If the user asks for explanation or planning only, answer directly and wait for an implementation request.",
  "Available skills are listed each turn. Use `skill-activate` to load one when its use matches the task; use `skill-list` for full descriptions.",
  "Only recent turns are visible. When the user references something you cannot see — a prior decision, an earlier error, a file discussed before — use `session-search` to find it. Do not ask the user to repeat themselves.",
  "Use `memory-search` when starting new work or when the user references conventions, preferences, or decisions from past sessions. Use `memory-add` to persist what the user teaches you — do not forget it.",
  "Questions about the codebase are answered by reading it. Search and read files immediately — never ask the user where something lives or for permission to investigate. Not knowing a location is never a blocker; it is a search away.",
  "Make the smallest root-cause change that matches local conventions.",
  "Skip unrelated or speculative detours.",
  "Avoid repeating tool calls without new information.",
  "After changing behavior, run related validation first. If validation is blocked or unavailable, say what was skipped and why.",
  "Keep responses concise and outcome-first. Format as plain text. Use `backticks` for code identifiers and **bold** for emphasis. No headings, links, or code blocks. Only use lists when absolutely necessary.",
  "Make reasonable assumptions to keep momentum; ask only when ambiguity or risk truly blocks progress.",
  "After writing the final response text, call exactly one lifecycle signal tool: `signal_done`, `signal_noop`, or `signal_blocked`. Use `signal_blocked` only for what your tools cannot obtain — a user decision, credential, or access — never for information findable in the workspace.",
];

const TOOL_IDS = toolIds();
const PROJECT_RULES_PRECEDENCE = "Project rules take precedence over generic guidance when they conflict.";

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

export function createInstructions(soulPrompt: string, workspace?: string, projectRulesPrompt = ""): string {
  const coreInstructions = CORE_INSTRUCTIONS.map((p) => `- ${p}`).join("\n");
  const runtimeInstructions = createRuntimeInstructions(workspace);
  const projectRulesSection =
    projectRulesPrompt.trim().length > 0 ? `${PROJECT_RULES_PRECEDENCE}\n\n${projectRulesPrompt}` : "";
  const sections = [soulPrompt, coreInstructions, projectRulesSection, runtimeInstructions].filter(
    (section) => section.trim().length > 0,
  );
  return sections.join("\n\n");
}
