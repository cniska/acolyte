import { z } from "zod";
import { addActiveSkill, removeActiveSkill } from "./chat-skill-activator";
import { type SkillSource, skillSourceSchema } from "./skill-contract";
import { findSkillByName, readSkillInstructions } from "./skill-ops";
import type { ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";
import { toolLabelKey } from "./tool-output-format";

function createActivateSkillTool(input: ToolkitInput) {
  return createTool({
    id: "skill-activate",
    toolkit: "skill",
    category: "meta",
    description: "Activate one or more skills by name to load structured guidance into context.",
    instruction:
      "Use `skill-activate` with one or more skill names to load their structured guidance; the available skills are listed each turn.",
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
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "skill-activate", toolCallId, toolInput, async (callId) => {
        const skills = toolInput.names.map((skillName) => {
          const skill = findSkillByName(skillName);
          if (!skill) throw new Error(`skill not found: "${skillName}"`);
          return skill;
        });
        input.onOutput({
          toolName: "skill-activate",
          content: {
            kind: "tool-header",
            labelKey: toolLabelKey("skill-activate"),
            detail: skills.map((s) => s.name).join(", "),
            state: "on",
          },
          toolCallId: callId,
        });
        const activated: { name: string; source: SkillSource; instructions: string }[] = [];
        for (const skill of skills) {
          const instructions = await readSkillInstructions(skill.path, toolInput.args);
          addActiveSkill(input.session, { name: skill.name, instructions });
          input.onSkillActivated({ name: skill.name, instructions });
          activated.push({ name: skill.name, source: skill.source, instructions });
        }
        return { kind: "skill-activate" as const, activated };
      });
    },
  });
}

function createDeactivateSkillTool(input: ToolkitInput) {
  return createTool({
    id: "skill-deactivate",
    toolkit: "skill",
    category: "meta",
    description: "Deactivate one or more active skills by name when their guidance no longer applies.",
    instruction: "Use `skill-deactivate` with one or more active skill names to drop their guidance from context.",
    inputSchema: z.object({
      names: z.array(z.string().min(1)).min(1),
    }),
    outputSchema: z.object({
      kind: z.literal("skill-deactivate"),
      deactivated: z.array(z.string().min(1)),
    }),
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "skill-deactivate", toolCallId, toolInput, async (callId) => {
        for (const name of toolInput.names) {
          const active = input.session.activeSkills?.some((s) => s.name === name);
          if (!active) throw new Error(`skill not active: "${name}"`);
        }
        input.onOutput({
          toolName: "skill-deactivate",
          content: {
            kind: "tool-header",
            labelKey: toolLabelKey("skill-deactivate"),
            detail: toolInput.names.join(", "),
            state: "off",
          },
          toolCallId: callId,
        });
        const deactivated: string[] = [];
        for (const name of toolInput.names) {
          removeActiveSkill(input.session, name);
          input.onSkillDeactivated(name);
          deactivated.push(name);
        }
        return { kind: "skill-deactivate" as const, deactivated };
      });
    },
  });
}

export function createSkillToolkit(input: ToolkitInput) {
  return {
    activateSkill: createActivateSkillTool(input),
    deactivateSkill: createDeactivateSkillTool(input),
  };
}
