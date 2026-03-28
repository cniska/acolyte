import { z } from "zod";
import { type ChecklistItem, checklistItemStatusSchema } from "./checklist-contract";
import type { ToolkitDeps, ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";

function createCreateChecklistTool(
  _deps: ToolkitDeps,
  input: ToolkitInput,
  state: Map<string, { title: string; items: ChecklistItem[] }>,
) {
  return createTool({
    id: "checklist-create",
    toolkit: "checklist",
    category: "meta",
    permissions: [],
    description: "Create an inline task checklist visible to the user. All items start as pending.",
    instruction:
      "Use `checklist-create` only for tasks with 5+ user-visible steps or clear independent subgoals the user would benefit from tracking. Define all steps upfront. Do not use it for a simple bounded fix. Use `checklist-update` as you work.",
    inputSchema: z.object({
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
    }),
    outputSchema: z.object({
      kind: z.literal("checklist-create"),
      groupId: z.string(),
      itemCount: z.number(),
    }),
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
    permissions: [],
    description: "Update the status of a single checklist item.",
    instruction:
      "Use `checklist-update` to mark one checklist item as `in_progress`, `done`, or `failed`. Use it only after `checklist-create` for the same groupId.",
    inputSchema: z.object({
      groupId: z.string().min(1),
      itemId: z.string().min(1),
      status: checklistItemStatusSchema,
    }),
    outputSchema: z.object({
      kind: z.literal("checklist-update"),
      groupId: z.string(),
      itemId: z.string(),
      status: checklistItemStatusSchema,
    }),
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
