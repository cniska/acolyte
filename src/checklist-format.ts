import { type ChecklistOutput, checklistMarker, checklistProgress } from "./checklist-contract";

export type FormattedChecklistItem = { id: string; text: string };

export function formatChecklist(output: ChecklistOutput): { header: string; items: FormattedChecklistItem[] } {
  const sorted = [...output.items].sort((a, b) => a.order - b.order);
  const { done, total } = checklistProgress(sorted);
  return {
    header: `${output.groupTitle} (${done}/${total})`,
    items: sorted.map((item) => ({ id: item.id, text: `${checklistMarker(item.status)} ${item.label}` })),
  };
}
