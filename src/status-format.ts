import type { CommandOutput } from "./chat-contract";
import { formatCommandOutput } from "./chat-format";
import { t } from "./i18n";
import type { StatusFields } from "./status-contract";

const STATUS_KEY_LABEL_MAP: Record<string, string> = {
  active_skill: t("status.label.active_skill"),
  capabilities: t("status.label.capabilities"),
  cloud_url: t("status.label.cloud_url"),
  cloud_user: t("status.label.cloud_user"),
  memory: t("status.label.memory"),
  model: t("status.label.model"),
  protocol_version: t("status.label.protocol_version"),
  providers: t("status.label.providers"),
  rpc_queue_length: t("status.label.rpc_queue_length"),
  service: t("status.label.service"),
  tasks_detached: t("status.label.tasks_detached"),
  tasks_running: t("status.label.tasks_running"),
  tasks_total: t("status.label.tasks_total"),
};

export function formatStatus(fields: StatusFields): string {
  const output = createStatusOutput(fields);
  return output ? formatCommandOutput(output) : "";
}

export function createStatusOutput(fields: StatusFields): CommandOutput | null {
  const rows = Object.entries(fields).filter(([key, value]) => {
    if (!(key in STATUS_KEY_LABEL_MAP)) return false;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.length > 0;
    return value.length > 0;
  });
  if (rows.length === 0) return null;
  const section: [string, string][] = rows.map(([key, value]) => [
    STATUS_KEY_LABEL_MAP[key] as string,
    Array.isArray(value) ? value.join(", ") : String(value),
  ]);
  return { header: t("chat.status.header"), sections: [section] };
}
