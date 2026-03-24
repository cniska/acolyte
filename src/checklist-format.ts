import { type ChecklistOutput, checklistMarker, checklistProgress } from "./checklist-contract";

export function formatChecklist(output: ChecklistOutput): { header: string; lines: string[] } {
  const sorted = [...output.items].sort((a, b) => a.order - b.order);
  const { done, total } = checklistProgress(sorted);
  return {
    header: `${output.groupTitle} (${done}/${total})`,
    lines: sorted.map((item) => `${checklistMarker(item.status)} ${item.label}`),
  };
}
