import { z } from "zod";
import { addActiveSkill } from "./chat-skill-activator";
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
          },
          toolCallId: callId,
        });
        const activated: { name: string; source: SkillSource; instructions: string }[] = [];
        for (const skill of skills) {
          const instructions = await readSkillInstructions(skill.path, toolInput.args);
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
    activateSkill: createActivateSkillTool(input),
  };
}
