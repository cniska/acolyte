import { z } from "zod";
import { compactText } from "./compact-text";
import { findSkillByName, getLoadedSkills, readSkillInstructions, SKILL_BUDGET, type SkillSource } from "./skills";
import type { ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";

const skillSourceSchema = z.enum(["bundled", "project"]) satisfies z.ZodType<SkillSource>;

function createListSkillsTool(input: ToolkitInput) {
  return createTool({
    id: "skill-list",
    toolkit: "skill",
    category: "meta",
    description: "List all available skills with names, descriptions, and sources.",
    instruction:
      "Use `skill-list` to see available engineering skills. Returns bundled (universal) and project (repo-specific) skills.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      kind: z.literal("skill-list"),
      skills: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          source: skillSourceSchema,
        }),
      ),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "skill-list", toolCallId, toolInput, async () => {
        const skills = getLoadedSkills().map((s) => ({
          name: s.name,
          description: s.description,
          source: s.source,
        }));
        return { kind: "skill-list" as const, skills };
      });
    },
  });
}

function createActivateSkillTool(input: ToolkitInput) {
  return createTool({
    id: "skill-activate",
    toolkit: "skill",
    category: "meta",
    description: "Activate a skill by name to load its structured guidance into context.",
    instruction:
      "Use `skill-activate` when you recognize that a skill's structured guidance would help with the current task. Use `skill-list` first to discover available skills.",
    inputSchema: z.object({
      name: z.string().min(1),
      args: z.string().optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("skill-activate"),
      name: z.string(),
      source: skillSourceSchema,
      instructions: z.string(),
    }),
    outputBudget: { maxChars: 4_000, maxLines: 120 },
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "skill-activate", toolCallId, toolInput, async () => {
        const skill = findSkillByName(toolInput.name);
        if (!skill) throw new Error(`skill not found: "${toolInput.name}"`);
        const raw = await readSkillInstructions(skill.path, toolInput.args);
        const instructions = compactText(raw, SKILL_BUDGET);
        return {
          kind: "skill-activate" as const,
          name: skill.name,
          source: skill.source,
          instructions,
        };
      });
    },
  });
}

export function createSkillToolkit(input: ToolkitInput) {
  return {
    listSkills: createListSkillsTool(input),
    activateSkill: createActivateSkillTool(input),
  };
}
