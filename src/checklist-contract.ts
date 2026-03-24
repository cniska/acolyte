import { z } from "zod";

export const checklistItemStatusSchema = z.enum(["pending", "in_progress", "done", "failed"]);
export type ChecklistItemStatus = z.infer<typeof checklistItemStatusSchema>;

export const checklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: checklistItemStatusSchema,
  order: z.number().int().nonnegative(),
});

export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistOutputSchema = z.object({
  groupId: z.string().min(1),
  groupTitle: z.string().min(1),
  items: z.array(checklistItemSchema),
});

export type ChecklistOutput = z.infer<typeof checklistOutputSchema>;

const STATUS_MARKERS: Record<ChecklistItemStatus, string> = {
  pending: "\u25CB",
  in_progress: "\u25D0",
  done: "\u25CF",
  failed: "\u25C9",
};

export function checklistMarker(status: ChecklistItemStatus): string {
  return STATUS_MARKERS[status];
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } {
  return {
    done: items.filter((item) => item.status === "done").length,
    total: items.length,
  };
}

export function formatChecklist(output: ChecklistOutput): { header: string; lines: string[] } {
  const sorted = [...output.items].sort((a, b) => a.order - b.order);
  const { done, total } = checklistProgress(sorted);
  return {
    header: `${output.groupTitle} (${done}/${total})`,
    lines: sorted.map((item) => `${checklistMarker(item.status)} ${item.label}`),
  };
}
