import { z } from "zod";
import { checklistItemStatusSchema } from "./checklist-contract";
import type { ToolkitDeps, ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";

const updateChecklistInputSchema = z.object({
  groupId: z.string().min(1).describe("Unique identifier for the checklist group."),
  groupTitle: z.string().min(1).describe("Title displayed as the checklist header."),
  items: z
    .array(
      z.object({
        id: z.string().min(1).describe("Unique item identifier within this group."),
        label: z.string().min(1).describe("Short description of the step."),
        status: checklistItemStatusSchema.describe("Current status of this item."),
        order: z.number().int().nonnegative().describe("Display position (0-based)."),
      }),
    )
    .min(1)
    .describe("Full list of checklist items. Always send the complete list, not a partial update."),
});

const updateChecklistOutputSchema = z.object({
  kind: z.literal("update-checklist"),
  groupId: z.string(),
  itemCount: z.number(),
});

function createUpdateChecklistTool(_deps: ToolkitDeps, input: ToolkitInput) {
  return createTool({
    id: "update-checklist",
    labelKey: "tool.label.update_checklist",
    category: "read",
    permissions: ["read"],
    description:
      "Create or update an inline task checklist visible to the user. Send the full item list each time — items not included are removed.",
    instruction:
      "Use `update-checklist` at the start of multi-step tasks to show the user a progress checklist. Create the checklist with all items as pending, then update individual item statuses as you work. Always send the complete item list.",
    inputSchema: updateChecklistInputSchema,
    outputSchema: updateChecklistOutputSchema,
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "update-checklist", toolCallId, toolInput, async () => {
        input.onChecklist({
          groupId: toolInput.groupId,
          groupTitle: toolInput.groupTitle,
          items: toolInput.items.map((item) => ({
            id: item.id,
            label: item.label,
            status: item.status,
            order: item.order,
          })),
        });

        return {
          kind: "update-checklist" as const,
          groupId: toolInput.groupId,
          itemCount: toolInput.items.length,
        };
      });
    },
  });
}

export function createChecklistToolkit(deps: ToolkitDeps, input: ToolkitInput) {
  return {
    updateChecklist: createUpdateChecklistTool(deps, input),
  };
}
