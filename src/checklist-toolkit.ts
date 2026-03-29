import { z } from "zod";
import { type ChecklistItem, checklistItemStatusSchema } from "./checklist-contract";
import type { ToolkitDeps, ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";

const createChecklistInputSchema = z.object({
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

const createChecklistOutputSchema = z.object({
  kind: z.literal("checklist-create"),
  groupId: z.string(),
  itemCount: z.number(),
});

const updateChecklistInputSchema = z.object({
  groupId: z.string().min(1),
  itemId: z.string().min(1),
  status: checklistItemStatusSchema,
});

const updateChecklistOutputSchema = z.object({
  kind: z.literal("checklist-update"),
  groupId: z.string(),
  itemId: z.string(),
  status: checklistItemStatusSchema,
});

function createCreateChecklistTool(
  _deps: ToolkitDeps,
  input: ToolkitInput,
  state: Map<string, { title: string; items: ChecklistItem[] }>,
) {
  return createTool({
    id: "checklist-create",
    toolkit: "checklist",
    category: "meta",
    description: "Create an inline task checklist visible to the user. All items start as pending.",
    instruction:
      "Use `checklist-create` once at the start of multi-step tasks to show the user a progress checklist. Define all steps upfront. Use `checklist-update` to change item statuses as you work.",
    inputSchema: createChecklistInputSchema,
    outputSchema: createChecklistOutputSchema,
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "checklist-create", toolCallId, toolInput, async () => {
        const items: ChecklistItem[] = toolInput.items.map((item) => ({
          id: item.id,
          label: item.label,
          status: "pending",
          order: item.order,
        }));
        state.set(toolInput.groupId, { title: toolInput.groupTitle, items });
        input.onChecklist({ groupId: toolInput.groupId, groupTitle: toolInput.groupTitle, items });
        return { kind: "checklist-create" as const, groupId: toolInput.groupId, itemCount: items.length };
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
    id: "checklist-update",
    toolkit: "checklist",
    category: "meta",
    description: "Update the status of a single checklist item.",
    instruction:
      "Use `checklist-update` to mark a checklist item as `in_progress`, `done`, or `failed`. Requires a prior `checklist-create` call for the same groupId.",
    inputSchema: updateChecklistInputSchema,
    outputSchema: updateChecklistOutputSchema,
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "checklist-update", toolCallId, toolInput, async () => {
        const group = state.get(toolInput.groupId);
        if (!group) throw new Error(`No checklist found for groupId "${toolInput.groupId}"`);
        if (!group.items.some((i) => i.id === toolInput.itemId)) {
          throw new Error(`No item "${toolInput.itemId}" in checklist "${toolInput.groupId}"`);
        }
        const items = group.items.map((i) => (i.id === toolInput.itemId ? { ...i, status: toolInput.status } : i));
        state.set(toolInput.groupId, { ...group, items });
        input.onChecklist({ groupId: toolInput.groupId, groupTitle: group.title, items });
        return {
          kind: "checklist-update" as const,
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
    createChecklist: createCreateChecklistTool(deps, input, state),
    updateChecklist: createUpdateChecklistTool(deps, input, state),
  };
}
