import { COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH } from "./chat-format";
import type { StatusFields } from "./status-contract";

export function formatStatusOutput(fields: StatusFields): string {
  const rows = Object.entries(fields).filter(([, value]) => {
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.length > 0;
    return value.length > 0;
  });
  if (rows.length === 0) return "";
  const colWidth = Math.max(COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH, ...rows.map(([key]) => `${key}:`.length + 1));
  return rows
    .map(([key, value]) => {
      const rendered = Array.isArray(value) ? value.join(", ") : String(value);
      return `${`${key}:`.padEnd(colWidth)}${rendered}`;
    })
    .join("\n");
}
