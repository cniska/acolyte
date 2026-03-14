import type { ModelPickerItem } from "./chat-picker";

export function suggestModels(query: string, models: ModelPickerItem[]): ModelPickerItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;

  const isSubsequence = (text: string): boolean => {
    let qi = 0;
    const lower = text.toLowerCase();
    for (let i = 0; i < lower.length && qi < q.length; i += 1) {
      if (lower[i] === q[qi]) qi += 1;
    }
    return qi === q.length;
  };

  const score = (label: string): number => {
    const lower = label.toLowerCase();
    if (lower.startsWith(q)) return 0;
    if (lower.includes(q)) return 1;
    if (isSubsequence(label)) return 2;
    return 3;
  };

  return models
    .map((item) => ({ item, score: score(item.label) }))
    .filter((item) => item.score < 3)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (a.item.label.length !== b.item.label.length) return a.item.label.length - b.item.label.length;
      return a.item.label.localeCompare(b.item.label);
    })
    .map((item) => item.item);
}
