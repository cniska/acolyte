import type { ActiveSkill } from "./skill-contract";
import { toolDefinitionsById, toolIds } from "./tool-registry";
import { createWorkspaceInstructions, resolveWorkspaceProfile } from "./workspace-profile";

// What the terminal surface renders, which the model cannot derive. Everything about how
// Acolyte works belongs in soul.md; this is the output contract, kept plain and separate.
const OUTPUT_CONTRACT =
  "Format as plain text. Use `backticks` for code identifiers and **bold** for emphasis; no headings or links. A fenced code block is only for a short illustrative snippet or a command to run — never file contents or a change you could make with a tool. Keep reasoning, structure, and how things connect in prose, even when it names many files or steps. Use a list only for a short, flat set of items with nothing to explain between them.";

const PROJECT_RULES_PRECEDENCE = "Project rules take precedence over generic guidance when they conflict.";

function createRuntimeInstructions(workspace?: string): string {
  const lines: string[] = [];
  // Read at call time, not module scope: the registry is built during its own module
  // evaluation, so an import-time read is a TDZ crash whenever a cycle reaches here first.
  for (const toolId of toolIds()) {
    const tool = toolDefinitionsById[toolId];
    if (tool?.instruction) lines.push(`- ${tool.instruction}`);
  }
  if (workspace) {
    const profile = resolveWorkspaceProfile(workspace);
    for (const line of createWorkspaceInstructions(profile)) lines.push(`- ${line}`);
  }
  return lines.join("\n");
}

// System message, not the volatile user turn: skill bodies land in the cached prefix
// (`applyPromptCacheMarkers`) — cache-read across a turn's calls, not re-billed every call.
export function renderActiveSkillBlock(skill: ActiveSkill): string {
  return `Active skill (${skill.name}):\n${skill.instructions}`;
}

function createSkillsSection(activeSkills: ActiveSkill[]): string {
  return activeSkills.map(renderActiveSkillBlock).join("\n\n");
}

export function createInstructions(
  soulPrompt: string,
  workspace?: string,
  projectRulesPrompt = "",
  activeSkills: ActiveSkill[] = [],
): string {
  const runtimeInstructions = createRuntimeInstructions(workspace);
  const projectRulesSection =
    projectRulesPrompt.trim().length > 0 ? `${PROJECT_RULES_PRECEDENCE}\n\n${projectRulesPrompt}` : "";
  const skillsSection = createSkillsSection(activeSkills);
  const sections = [soulPrompt, OUTPUT_CONTRACT, projectRulesSection, skillsSection, runtimeInstructions].filter(
    (section) => section.trim().length > 0,
  );
  return sections.join("\n\n");
}
