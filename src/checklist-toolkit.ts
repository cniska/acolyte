import { z } from "zod";
import { type ChecklistItem, checklistItemStatusSchema } from "./checklist-contract";
import type { ToolkitDeps, ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";

const setChecklistInputSchema = z.object({
  groupId: z.string().min(1),
  groupTitle: z.string().min(1),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        order: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

const setChecklistOutputSchema = z.object({
  kind: z.literal("set-checklist"),
  groupId: z.string(),
  itemCount: z.number(),
});

const updateChecklistInputSchema = z.object({
  groupId: z.string().min(1),
  itemId: z.string().min(1),
  status: checklistItemStatusSchema,
});

const updateChecklistOutputSchema = z.object({
  kind: z.literal("update-checklist"),
  groupId: z.string(),
  itemId: z.string(),
  status: checklistItemStatusSchema,
});

function createSetChecklistTool(
  _deps: ToolkitDeps,
  input: ToolkitInput,
  state: Map<string, { title: string; items: ChecklistItem[] }>,
) {
  return createTool({
    id: "set-checklist",
    category: "meta",
    permissions: [],
    description: "Create an inline task checklist visible to the user. All items start as pending.",
    instruction:
      "Use `set-checklist` once at the start of multi-step tasks to show the user a progress checklist. Define all steps upfront. Use `update-checklist` to change item statuses as you work.",
    inputSchema: setChecklistInputSchema,
    outputSchema: setChecklistOutputSchema,
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "set-checklist", toolCallId, toolInput, async () => {
        const items: ChecklistItem[] = toolInput.items.map((item) => ({
          id: item.id,
          label: item.label,
          status: "pending",
          order: item.order,
        }));
        state.set(toolInput.groupId, { title: toolInput.groupTitle, items });
        input.onChecklist({ groupId: toolInput.groupId, groupTitle: toolInput.groupTitle, items });
        return { kind: "set-checklist" as const, groupId: toolInput.groupId, itemCount: items.length };
      });
    },
  });
}

function createUpdateChecklistTool(
  _deps: ToolkitDeps,
  input: ToolkitInput,
  state: Map<string, { title: string; items: ChecklistItem[] }>,
) {
  return createTool({
    id: "update-checklist",
    category: "meta",
    permissions: [],
    description: "Update the status of a single checklist item.",
    instruction:
      "Use `update-checklist` to mark a checklist item as `in_progress`, `done`, or `failed`. Requires a prior `set-checklist` call for the same groupId.",
    inputSchema: updateChecklistInputSchema,
    outputSchema: updateChecklistOutputSchema,
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "update-checklist", toolCallId, toolInput, async () => {
        const group = state.get(toolInput.groupId);
        if (!group) throw new Error(`No checklist found for groupId "${toolInput.groupId}"`);
        const item = group.items.find((i) => i.id === toolInput.itemId);
        if (!item) throw new Error(`No item "${toolInput.itemId}" in checklist "${toolInput.groupId}"`);
        item.status = toolInput.status;
        input.onChecklist({ groupId: toolInput.groupId, groupTitle: group.title, items: group.items });
        return {
          kind: "update-checklist" as const,
          groupId: toolInput.groupId,
          itemId: toolInput.itemId,
          status: toolInput.status,
        };
      });
    },
  });
}

export function createChecklistToolkit(deps: ToolkitDeps, input: ToolkitInput) {
  const state = new Map<string, { title: string; items: ChecklistItem[] }>();
  return {
    setChecklist: createSetChecklistTool(deps, input, state),
    updateChecklist: createUpdateChecklistTool(deps, input, state),
  };
}
