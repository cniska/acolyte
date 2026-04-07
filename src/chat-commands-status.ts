import { type ChatRow, createRow } from "./chat-contract";
import type { StatusFields } from "./status-contract";
import { createStatusOutput } from "./status-format";

export function statusRows(status: StatusFields): ChatRow[] {
  const output = createStatusOutput(status);
  if (!output) return [];
  return [createRow("system", output)];
}
