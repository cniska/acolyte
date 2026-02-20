export function parseImplementedFeatures(markdown: string, limit = 8): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## Implemented");
  if (start < 0) {
    return [];
  }
  const items: string[] = [];
  for (let idx = start + 1; idx < lines.length; idx += 1) {
    const line = lines[idx]?.trim() ?? "";
    if (line.startsWith("## ")) {
      break;
    }
    if (line.startsWith("- ")) {
      items.push(line.slice(2).trim());
      if (items.length >= limit) {
        break;
      }
    }
  }
  return items;
}
