import { type TasklistOutput, tasklistMarker, tasklistProgress } from "./tasklist-contract";

export type FormattedTasklistItem = { id: string; marker: string; label: string };

export function formatTasklist(output: TasklistOutput): { header: string; items: FormattedTasklistItem[] } {
  const sorted = [...output.items].sort((a, b) => a.order - b.order);
  const { done, total } = tasklistProgress(sorted);
  return {
    header: `${output.groupTitle} (${done}/${total})`,
    items: sorted.map((item) => ({ id: item.id, marker: tasklistMarker(item.status), label: item.label })),
  };
}
