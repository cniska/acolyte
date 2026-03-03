import { COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH } from "./chat-format";
import type { StatusFields } from "./status-contract";

export function formatStatusOutput(fields: StatusFields): string {
  const rows = Object.entries(fields).filter(([, value]) =>
    typeof value === "number" ? Number.isFinite(value) : value.length > 0,
  );
  if (rows.length === 0) return "";
  const colWidth = Math.max(COMMAND_OUTPUT_KEY_COLUMN_MIN_WIDTH, ...rows.map(([key]) => `${key}:`.length + 1));
  return rows.map(([key, value]) => `${`${key}:`.padEnd(colWidth)}${String(value)}`).join("\n");
}
