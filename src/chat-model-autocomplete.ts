const MAX_MODEL_SUGGESTIONS = 8;

export function suggestModels(query: string, models: string[], max = MAX_MODEL_SUGGESTIONS): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return models.slice(0, max);

  const isSubsequence = (text: string): boolean => {
    let qi = 0;
    const lower = text.toLowerCase();
    for (let i = 0; i < lower.length && qi < q.length; i += 1) {
      if (lower[i] === q[qi]) qi += 1;
    }
    return qi === q.length;
  };

  const score = (id: string): number => {
    const lower = id.toLowerCase();
    if (lower.startsWith(q)) return 0;
    if (lower.includes(q)) return 1;
    if (isSubsequence(id)) return 2;
    return 3;
  };

  return models
    .map((id) => ({ id, score: score(id) }))
    .filter((item) => item.score < 3)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (a.id.length !== b.id.length) return a.id.length - b.id.length;
      return a.id.localeCompare(b.id);
    })
    .map((item) => item.id)
    .slice(0, max);
}
