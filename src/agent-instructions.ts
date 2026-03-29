import type { AgentMode } from "./agent-contract";
import { agentModes, toolIdsForMode } from "./agent-modes";
import { toolDefinitionsById } from "./tool-registry";
import { createWorkspaceInstructions, resolveWorkspaceProfile } from "./workspace-profile";

const BASE_INSTRUCTIONS = [
  "Write ONE short direct sentence before acting.",
  'Use factual prose like "Checking X, then updating Y." Do not say "I will..." and do not describe multiple upcoming steps.',
  "After that sentence, act IMMEDIATELY.",
  "Do NOT send another assistant message until you are blocked or done.",
  "During tool use, stay silent. Do NOT narrate obvious read, edit, search, or verify steps.",
  "Keep tool calls and file changes within the current workspace and the requested scope.",
  "Prefer dedicated project tools; use shell only when no dedicated tool exists.",
  "Prefer targeted, surgical edits. Preserve unrelated content and surrounding structure, and change only the minimal lines needed.",
  "Do exactly the requested change. Do not add opportunistic comments, refactors, cleanup, or extra edge-case handling unless the request or concrete evidence requires it.",
  "Preserve local conventions in the file you are editing. Match nearby style and path forms instead of inventing a new one.",
  "When fixing an existing path or link, keep the file's local relative/absolute reference style unless the user explicitly asked to normalize it.",
  "Keep responses concise and outcome-first. Prefer short direct prose, not dash bullets, unless the user asked for a list.",
  "Treat assistant text as delta-only. After tool output, add only what the tool output did not already make clear.",
  "Do NOT recap visible tool output.",
  "If a write-tool diff or preview already makes the result obvious, say NOTHING after it.",
  "If a checklist is present, let the checklist and tool output show progress instead of narrating each step in prose.",
  "If you notice you have derailed, stop taking new actions. Do not keep searching, rereading, or narrating just to recover.",
  "If you can correct the mistake safely, say so briefly, correct it, and continue.",
  "If you cannot recover without user input, use `@signal blocked`.",
  "Make reasonable assumptions to keep momentum; ask only when blocked by ambiguity or risk.",
  "When lint or format checks fail, run the project auto-fix command (if available) before attempting manual repairs.",
  "The `@signal` line is how you communicate task state to the host.",
  "End every final response with EXACTLY ONE `@signal` line.",
  "Use `@signal done` only when the requested work is complete.",
  "Use `@signal no_op` only when no change is needed.",
  "Use `@signal blocked` only when you cannot proceed without user input. This stops execution until the user replies.",
  "After `@signal blocked`, write ONE short sentence stating what is missing and why it is needed.",
];

function formatSection(title: string, content: string): string {
  if (content.length === 0) return "";
  return `## ${title}\n${content}`;
}

function createModePreamble(mode: AgentMode): string {
  return agentModes[mode].preamble.map((p) => `- ${p}`).join("\n");
}

function createToolInstructions(mode: AgentMode): string {
  const lines: string[] = [];
  for (const toolId of toolIdsForMode(mode)) {
    const tool = toolDefinitionsById[toolId];
    if (tool?.instruction) lines.push(`- ${tool.instruction}`);
  }
  return lines.join("\n");
}

function createWorkspaceInstructionBlock(workspace?: string): string {
  if (!workspace) return "";
  const profile = resolveWorkspaceProfile(workspace);
  return createWorkspaceInstructions(profile)
    .map((line) => `- ${line}`)
    .join("\n");
}

export function createModeInstructions(mode: AgentMode, workspace?: string): string {
  const sections = [
    formatSection("Mode Instructions", createModePreamble(mode)),
    formatSection("Tool Instructions", createToolInstructions(mode)),
    formatSection("Workspace", createWorkspaceInstructionBlock(workspace)),
  ];
  return sections.filter((section) => section.length > 0).join("\n\n");
}

export function createInstructions(soulPrompt: string, mode: AgentMode, workspace?: string): string {
  const baseInstructions = BASE_INSTRUCTIONS.map((p) => `- ${p}`).join("\n");
  const sections = [
    soulPrompt,
    formatSection("Mode Instructions", createModePreamble(mode)),
    formatSection("Global Rules", baseInstructions),
    formatSection("Tool Instructions", createToolInstructions(mode)),
    formatSection("Workspace", createWorkspaceInstructionBlock(workspace)),
  ];
  return sections.filter((section) => section.length > 0).join("\n\n");
}
