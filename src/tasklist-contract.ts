import { z } from "zod";
import { GLYPH_FILLED, GLYPH_FISHEYE, GLYPH_HOLLOW } from "./chat-glyphs";

export const tasklistItemStatusSchema = z.enum(["pending", "in_progress", "done", "failed"]);
export type TasklistItemStatus = z.infer<typeof tasklistItemStatusSchema>;

export const tasklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: tasklistItemStatusSchema,
  order: z.number().int().nonnegative(),
});

export type TasklistItem = z.infer<typeof tasklistItemSchema>;

export const tasklistOutputSchema = z.object({
  groupId: z.string().min(1),
  groupTitle: z.string().min(1),
  items: z.array(tasklistItemSchema),
});

export type TasklistOutput = z.infer<typeof tasklistOutputSchema>;

const STATUS_MARKERS: Record<TasklistItemStatus, string> = {
  pending: GLYPH_HOLLOW,
  in_progress: GLYPH_FISHEYE,
  done: GLYPH_FILLED,
  failed: GLYPH_FILLED,
};

export function tasklistMarker(status: TasklistItemStatus): string {
  return STATUS_MARKERS[status];
}

export function tasklistProgress(items: TasklistItem[]): { done: number; total: number } {
  return {
    done: items.filter((item) => item.status === "done").length,
    total: items.length,
  };
}
