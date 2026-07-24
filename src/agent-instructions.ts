import { toolDefinitionsById, toolIds } from "./tool-registry";
import { createWorkspaceInstructions, resolveWorkspaceProfile } from "./workspace-profile";

const CORE_INSTRUCTIONS = [
  "Stay in this workspace and this scope.",
  "Prefer dedicated project tools; use shell only when it helps.",
  "If implementation intent is clear, do the work and stay with it until the task is complete.",
  "If the user asks for explanation or planning only, answer directly and wait for an implementation request.",
  "When the user references something you cannot see, a prior decision, an earlier error, a file discussed before, use `session-search` rather than asking them to repeat themselves.",
  "Search and read files immediately; never ask the user where something lives or for permission to investigate. Not knowing a location is never a blocker; it is a search away.",
  "Make the smallest root-cause change that matches local conventions.",
  "Skip unrelated or speculative detours.",
  "After changing behavior, run related validation first. If validation is blocked or unavailable, say what was skipped and why.",
  "Write user-facing text for a person, not a log: flowing prose in complete sentences, leading with the outcome. Match the shape to the task, and give a simple question a direct answer.",
  "Format as plain text. Use `backticks` for code identifiers and **bold** for emphasis; no headings or links. A fenced code block is only for a short illustrative snippet or a command to run — never file contents or a change you could make with a tool. Keep reasoning, structure, and how things connect in prose, even when it names many files or steps. Use a list only for a short, flat set of items with nothing to explain between them.",
  "Before your first tool call, briefly state what you are about to do. While working, give short updates at key moments: when you find something load-bearing like a bug or root cause, when you change direction, or when you have made progress without a recent update.",
  "Make reasonable assumptions to keep momentum; ask only when ambiguity or risk truly blocks progress.",
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
