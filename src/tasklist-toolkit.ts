import { z } from "zod";
import { type TasklistItem, tasklistItemStatusSchema } from "./tasklist-contract";
import type { ToolkitInput } from "./tool-contract";
import { createTool } from "./tool-contract";
import { runTool } from "./tool-execution";

const createTasklistInputSchema = z.object({
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

const createTasklistOutputSchema = z.object({
  kind: z.literal("tasklist-create"),
  groupId: z.string(),
  itemCount: z.number(),
});

const updateTasklistInputSchema = z.object({
  groupId: z.string().min(1),
  itemId: z.string().min(1),
  status: tasklistItemStatusSchema,
});

const updateTasklistOutputSchema = z.object({
  kind: z.literal("tasklist-update"),
  groupId: z.string(),
  itemId: z.string(),
  status: tasklistItemStatusSchema,
});

function createCreateTasklistTool(input: ToolkitInput, state: Map<string, { title: string; items: TasklistItem[] }>) {
  return createTool({
    id: "tasklist-create",
    toolkit: "tasklist",
    category: "meta",
    description: "Create an inline tasklist visible to the user. All items start as pending.",
    instruction:
      "Use `tasklist-create` once for multi-step tasks. Define all steps upfront, then use `tasklist-update` as progress changes.",
    inputSchema: createTasklistInputSchema,
    outputSchema: createTasklistOutputSchema,
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "tasklist-create", toolCallId, toolInput, async () => {
        const items: TasklistItem[] = toolInput.items.map((item) => ({
          id: item.id,
          label: item.label,
          status: "pending",
          order: item.order,
        }));
        state.set(toolInput.groupId, { title: toolInput.groupTitle, items });
        input.onTasklist({ groupId: toolInput.groupId, groupTitle: toolInput.groupTitle, items });
        return { kind: "tasklist-create" as const, groupId: toolInput.groupId, itemCount: items.length };
      });
    },
  });
}

function createUpdateTasklistTool(input: ToolkitInput, state: Map<string, { title: string; items: TasklistItem[] }>) {
  return createTool({
    id: "tasklist-update",
    toolkit: "tasklist",
    category: "meta",
    description: "Update the status of a single tasklist item.",
    instruction:
      "Use `tasklist-update` to set item status (`in_progress`, `done`, `failed`) after `tasklist-create` for the same groupId.",
    inputSchema: updateTasklistInputSchema,
    outputSchema: updateTasklistOutputSchema,
    execute: async (toolInput, toolCallId) => {
      return runTool(input.session, "tasklist-update", toolCallId, toolInput, async () => {
        const group = state.get(toolInput.groupId);
        if (!group) throw new Error(`No tasklist found for groupId "${toolInput.groupId}"`);
        if (!group.items.some((i) => i.id === toolInput.itemId)) {
          throw new Error(`No item "${toolInput.itemId}" in tasklist "${toolInput.groupId}"`);
        }
        const items = group.items.map((i) => (i.id === toolInput.itemId ? { ...i, status: toolInput.status } : i));
        state.set(toolInput.groupId, { ...group, items });
        input.onTasklist({ groupId: toolInput.groupId, groupTitle: group.title, items });
        return {
          kind: "tasklist-update" as const,
          groupId: toolInput.groupId,
          itemId: toolInput.itemId,
          status: toolInput.status,
        };
      });
    },
  });
}

export function createTasklistToolkit(input: ToolkitInput) {
  const state = new Map<string, { title: string; items: TasklistItem[] }>();
  return {
    createTasklist: createCreateTasklistTool(input, state),
    updateTasklist: createUpdateTasklistTool(input, state),
  };
}
