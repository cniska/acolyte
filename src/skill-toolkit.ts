import { z } from "zod";
import { addActiveSkill } from "./chat-skill-activator";
import { compactText } from "./compact-text";
import { type SkillSource, skillSourceSchema } from "./skill-contract";
import { findSkillByName, getLoadedSkills, readSkillInstructions, SKILL_BUDGET } from "./skill-ops";
import type { ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";
import { toolLabelKey } from "./tool-output-format";

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
    description: "Activate one or more skills by name to load structured guidance into context.",
    instruction:
      "Use `skill-activate` when you recognize that a skill's structured guidance would help with the current task. Use `skill-list` first to discover available skills.",
    inputSchema: z.object({
      names: z.array(z.string().min(1)).min(1),
      args: z.string().optional(),
    }),
    outputSchema: z.object({
      kind: z.literal("skill-activate"),
      activated: z.array(
        z.object({
          name: z.string(),
          source: skillSourceSchema,
          instructions: z.string(),
        }),
      ),
    }),
    outputBudget: { maxChars: 8_000, maxLines: 240 },
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "skill-activate", toolCallId, toolInput, async (callId) => {
        const activated: { name: string; source: SkillSource; instructions: string }[] = [];
        for (const skillName of toolInput.names) {
          const skill = findSkillByName(skillName);
          if (!skill) throw new Error(`skill not found: "${skillName}"`);
          input.onOutput({
            toolName: "skill-activate",
            content: { kind: "tool-header", labelKey: toolLabelKey("skill-activate"), detail: skill.name },
            toolCallId: callId,
          });
          const raw = await readSkillInstructions(skill.path, toolInput.args);
          const instructions = compactText(raw, SKILL_BUDGET);
          addActiveSkill(input.session, { name: skill.name, instructions });
          activated.push({ name: skill.name, source: skill.source, instructions });
        }
        return { kind: "skill-activate" as const, activated };
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
