export function formatStatusOutput(fields: Record<string, string>): string {
  const rows = Object.entries(fields).filter(([, value]) => value.length > 0);
  if (rows.length === 0) return "";
  const colWidth = Math.max(20, ...rows.map(([key]) => `${key}:`.length + 1));
  return rows.map(([key, value]) => `${`${key}:`.padEnd(colWidth)}${value}`).join("\n");
}
