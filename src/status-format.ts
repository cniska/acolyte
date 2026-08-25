import type { CommandOutput } from "./chat-contract";
import { formatCommandOutput } from "./chat-format";
import { type TranslationKey, t } from "./i18n";
import type { StatusFields } from "./status-contract";

const STATUS_KEY_LABELS = {
  capabilities: "status.label.capabilities",
  cloud_url: "status.label.cloud_url",
  cloud_user: "status.label.cloud_user",
  memory: "status.label.memory",
  model: "status.label.model",
  protocol_version: "status.label.protocol_version",
  provider_auth: "status.label.providers",
  rpc_queue_length: "status.label.rpc_queue_length",
  service: "status.label.service",
  tasks_running: "status.label.tasks_running",
  tasks_total: "status.label.tasks_total",
  "resources.config.collisions": "status.label.resources.config.collisions",
  "resources.prompt.agents": "status.label.resources.prompt.agents",
  "resources.skills.invalid": "status.label.resources.skills.invalid",
  "resources.skills.duplicates": "status.label.resources.skills.duplicates",
  "resources.skills.read_errors": "status.label.resources.skills.read_errors",
  "resources.skills.status": "status.label.resources.skills.status",
  "resources.plugins.loaded": "status.label.resources.plugins.loaded",
  "resources.plugins.rejected": "status.label.resources.plugins.rejected",
  "resources.plugins.duplicates": "status.label.resources.plugins.duplicates",
  "resources.plugins.mcp_disabled": "status.label.resources.plugins.mcp_disabled",
  "resources.plugins.servers_skipped": "status.label.resources.plugins.servers_skipped",
  "resources.plugins.skills_invalid": "status.label.resources.plugins.skills_invalid",
  "resources.plugins.skills_duplicates": "status.label.resources.plugins.skills_duplicates",
} as const satisfies Record<string, TranslationKey>;

type StatusLabelKey = keyof typeof STATUS_KEY_LABELS;

function isStatusLabelKey(key: string): key is StatusLabelKey {
  return key in STATUS_KEY_LABELS;
}

export function formatStatus(fields: StatusFields): string {
  const output = createStatusOutput(fields);
  return output ? formatCommandOutput(output) : "";
}

export function createStatusOutput(fields: StatusFields): CommandOutput | null {
  const rows = Object.entries(fields).filter(([key, value]) => {
    if (!isStatusLabelKey(key)) return false;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.length > 0;
    return value.length > 0;
  });
  if (rows.length === 0) return null;
  const section: [string, string][] = rows.map(([key, value]) => [
    t(STATUS_KEY_LABELS[key as StatusLabelKey]),
    Array.isArray(value) ? value.join(", ") : String(value),
  ]);
  return { header: t("status.header"), sections: [section] };
}
