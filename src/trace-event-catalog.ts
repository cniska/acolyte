import { z } from "zod";

export type TraceFieldSpec = string | { key: string; label: string };

export const traceFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()]);
export const traceFieldsSchema = z.record(z.string(), traceFieldValueSchema);
export type TraceFields = z.infer<typeof traceFieldsSchema>;

export const traceEventNameSchema = z.enum([
  "task.state_updated",
  "rpc.task.accepted",
  "rpc.task.queued",
  "rpc.task.dequeued",
  "rpc.worker.scheduled",
  "rpc.task.started",
  "chat.request.started",
  "chat.request.completed",
  "lifecycle.workspace.profile",
  "lifecycle.workspace.sandbox",
  "lifecycle.start",
  "lifecycle.prepare",
  "lifecycle.window.drop",
  "lifecycle.generate.start",
  "lifecycle.generate.done",
  "lifecycle.generate.error",
  "lifecycle.error",
  "lifecycle.yield",
  "lifecycle.tool.call",
  "lifecycle.tool.cache",
  "lifecycle.tool.result",
  "lifecycle.tool.error",
  "lifecycle.tool.output",
  "lifecycle.tool.hook_failed",
  "lifecycle.budget",
  "lifecycle.signal.accepted",
  "lifecycle.signal.rejected",
  "lifecycle.signal.missing",
  "lifecycle.skill.context",
  "lifecycle.effect.format",
  "lifecycle.effect.lint",
  "lifecycle.effect.lint.output",
  "lifecycle.effect.install",
  "lifecycle.eval.decision",
  "lifecycle.eval.skipped",
  "lifecycle.reminders.injected",
  "lifecycle.memory.commit_scheduled",
  "lifecycle.memory.commit_done",
  "lifecycle.memory.commit_failed",
  "lifecycle.summary",
]);

export type TraceEventName = z.infer<typeof traceEventNameSchema>;

type TraceEventDefinition = {
  fields: z.ZodType<TraceFields>;
  displayFields: TraceFieldSpec[];
};

function fieldSchema(keys: readonly TraceFieldSpec[]): z.ZodType<TraceFields> {
  const shape: Record<string, z.ZodOptional<typeof traceFieldValueSchema>> = {};
  for (const spec of keys) {
    const key = typeof spec === "string" ? spec : spec.key;
    shape[key] = traceFieldValueSchema.optional();
  }
  return z.object(shape).catchall(traceFieldValueSchema);
}

function defineEvent(displayFields: readonly TraceFieldSpec[]): TraceEventDefinition {
  return {
    fields: fieldSchema(displayFields),
    displayFields: [...displayFields],
  };
}

export const TRACE_EVENT_CATALOG: Record<TraceEventName, TraceEventDefinition> = {
  "task.state_updated": defineEvent([
    { key: "from_state", label: "from" },
    { key: "to_state", label: "to" },
    "reason",
    "transport",
  ]),
  "rpc.task.accepted": defineEvent([
    { key: "session_id", label: "session" },
    { key: "queued_task_count", label: "queued" },
    { key: "has_running_task", label: "has_running" },
  ]),
  "rpc.task.queued": defineEvent([{ key: "queue_position", label: "position" }, "running_task_id"]),
  "rpc.task.dequeued": defineEvent([]),
  "rpc.worker.scheduled": defineEvent([
    { key: "session_id", label: "session" },
    { key: "queued_task_count", label: "queued" },
  ]),
  "rpc.task.started": defineEvent([{ key: "session_id", label: "session" }]),
  "chat.request.started": defineEvent(["model", "workspace_mode", "message_chars"]),
  "chat.request.completed": defineEvent(["duration_ms", "model_calls", "tool_count"]),
  "lifecycle.workspace.profile": defineEvent([
    "ecosystem",
    "package_manager",
    "lint_command",
    "format_command",
    "test_command",
    "line_width",
  ]),
  "lifecycle.workspace.sandbox": defineEvent(["workspace", "sandbox_root"]),
  "lifecycle.start": defineEvent(["model"]),
  "lifecycle.prepare": defineEvent(["model", "history_messages"]),
  "lifecycle.window.drop": defineEvent([
    "dropped_turns",
    "dropped_tokens",
    "tokens_idle_at_drop",
    "kept_history_tokens",
    "missing_turns",
  ]),
  "lifecycle.generate.start": defineEvent(["model"]),
  "lifecycle.generate.done": defineEvent(["model", "tool_calls", "text_chars"]),
  "lifecycle.generate.error": defineEvent(["model", "error"]),
  "lifecycle.error": defineEvent(["source", "kind", "code", "category", "tool"]),
  "lifecycle.yield": defineEvent([]),
  "lifecycle.tool.call": defineEvent(["tool", "path", "paths", "pattern", "command"]),
  "lifecycle.tool.cache": defineEvent(["tool", "hit", "hits", "misses", "size"]),
  "lifecycle.tool.result": defineEvent(["tool", "duration_ms", "is_error"]),
  "lifecycle.tool.error": defineEvent(["tool", "error"]),
  "lifecycle.tool.output": defineEvent(["tool"]),
  "lifecycle.tool.hook_failed": defineEvent(["tool", "hook", "error"]),
  "lifecycle.budget": defineEvent(["tool", "action", "detail"]),
  "lifecycle.signal.accepted": defineEvent(["signal"]),
  "lifecycle.signal.rejected": defineEvent(["signal", "reason", "path", "action"]),
  "lifecycle.signal.missing": defineEvent(["action"]),
  "lifecycle.skill.context": defineEvent(["skill_name", "instruction_chars"]),
  "lifecycle.effect.format": defineEvent(["files"]),
  "lifecycle.effect.lint": defineEvent(["files"]),
  "lifecycle.effect.lint.output": defineEvent(["output"]),
  "lifecycle.effect.install": defineEvent(["package_manager", "command", "status"]),
  "lifecycle.eval.decision": defineEvent(["effect", "action"]),
  "lifecycle.eval.skipped": defineEvent(["reason"]),
  "lifecycle.reminders.injected": defineEvent(["count", "tags"]),
  "lifecycle.memory.commit_scheduled": defineEvent(["queue_key", "session_id", "message_count", "output_chars"]),
  "lifecycle.memory.commit_done": defineEvent([
    "queue_key",
    "project_promoted_facts",
    "user_promoted_facts",
    "session_scoped_facts",
    "dropped_untagged_facts",
    "distill_tokens",
  ]),
  "lifecycle.memory.commit_failed": defineEvent(["queue_key", "message"]),
  "lifecycle.summary": defineEvent([
    "model_calls",
    { key: "tool_calls", label: "total_tool_calls" },
    { key: "read_calls", label: "read" },
    { key: "search_calls", label: "search" },
    { key: "write_calls", label: "write" },
    { key: "memory_search_calls", label: "memory_search" },
    { key: "session_search_calls", label: "session_search" },
    { key: "pre_write_discovery_calls", label: "pre_write_discovery" },
    { key: "duplicate_discovery_calls", label: "dup_discovery" },
    { key: "budget_exhausted_count", label: "budget_exhausted" },
    "has_error",
  ]),
};

export function isCatalogTraceEvent(event: string | undefined): event is TraceEventName {
  return Boolean(event && event in TRACE_EVENT_CATALOG);
}

export function traceEventDisplayFields(event: string | undefined): TraceFieldSpec[] {
  if (!event) return [];
  if (isCatalogTraceEvent(event)) return TRACE_EVENT_CATALOG[event].displayFields;
  if (event.startsWith("lifecycle.memory.")) return ["reason"];
  return [];
}

export function parseTraceFields(event: string | undefined, fields: TraceFields): TraceFields {
  if (isCatalogTraceEvent(event)) return TRACE_EVENT_CATALOG[event].fields.parse(fields);
  return traceFieldsSchema.parse(fields);
}

export function missingCatalogDisplayFields(event: string | undefined, fields: TraceFields): string[] {
  if (!isCatalogTraceEvent(event)) return [];
  const missing: string[] = [];
  for (const spec of TRACE_EVENT_CATALOG[event].displayFields) {
    const key = typeof spec === "string" ? spec : spec.key;
    if (!(key in fields)) missing.push(key);
  }
  return missing;
}
