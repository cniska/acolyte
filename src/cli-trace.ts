import { z } from "zod";
import { hasBoolFlag, parseFlag, parsePositional, parseTailCount } from "./cli-args";
import { createJsonOutput, createTextOutput } from "./cli-output";
import { formatRelativeTime } from "./datetime";
import { t } from "./i18n";
import type { LogLine } from "./log-parser";
import type { TraceStore } from "./trace-store";

type TraceModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  traceStore?: TraceStore;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

const traceEventSchema = z.enum([
  "task.state_updated",
  "rpc.task.accepted",
  "rpc.task.queued",
  "rpc.task.dequeued",
  "rpc.worker.scheduled",
  "rpc.task.started",
  "chat.request.started",
  "chat.request.completed",
  "lifecycle.start",
  "lifecycle.classify",
  "lifecycle.prepare",
  "lifecycle.mode.changed",
  "lifecycle.agent.reconfigured",
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
  "lifecycle.guard",
  "lifecycle.signal.accepted",
  "lifecycle.skill.context",
  "lifecycle.eval.decision",
  "lifecycle.eval.skipped",
  "lifecycle.eval.lint",
  "lifecycle.eval.guard_recovery",
  "lifecycle.eval.repeated_failure",
  "lifecycle.eval.verify_cycle",
  "lifecycle.eval.verify_failure",
  "lifecycle.eval.tool_recovery",
  "lifecycle.summary",
]);

type TraceEvent = z.infer<typeof traceEventSchema>;
type FieldSpec = string | { key: string; label: string };

const EVENT_FIELDS: Record<TraceEvent, FieldSpec[]> = {
  "task.state_updated": [{ key: "from_state", label: "from" }, { key: "to_state", label: "to" }, "reason", "transport"],
  "rpc.task.accepted": [
    { key: "session_id", label: "session" },
    { key: "queued_task_count", label: "queued" },
    { key: "has_running_task", label: "has_running" },
  ],
  "rpc.task.queued": [{ key: "queue_position", label: "position" }, "running_task_id"],
  "rpc.task.dequeued": [],
  "rpc.worker.scheduled": [
    { key: "session_id", label: "session" },
    { key: "queued_task_count", label: "queued" },
  ],
  "rpc.task.started": [{ key: "session_id", label: "session" }],
  "chat.request.started": ["model", "workspace_mode", "message_chars"],
  "chat.request.completed": ["duration_ms", "model_calls", "tool_count"],
  "lifecycle.start": ["mode", "model"],
  "lifecycle.classify": ["mode", "model", "provider"],
  "lifecycle.prepare": ["mode", "model", "history_messages"],
  "lifecycle.mode.changed": ["from", "to", "trigger"],
  "lifecycle.agent.reconfigured": ["from_mode", "to_mode", "from_model", "to_model"],
  "lifecycle.generate.start": ["model", "mode"],
  "lifecycle.generate.done": ["model", "tool_calls", "text_chars"],
  "lifecycle.generate.error": ["model", "error"],
  "lifecycle.error": ["source", "kind", "code", "category", "tool"],
  "lifecycle.yield": ["generation_attempt"],
  "lifecycle.tool.call": ["tool", "path", "paths", "pattern", "command"],
  "lifecycle.tool.cache": ["tool", "hit", "hits", "misses", "size"],
  "lifecycle.tool.result": ["tool", "duration_ms", "is_error"],
  "lifecycle.tool.error": ["tool", "error"],
  "lifecycle.tool.output": ["tool"],
  "lifecycle.guard": ["guard", "tool", "action", "detail"],
  "lifecycle.signal.accepted": ["signal", "mode"],
  "lifecycle.skill.context": ["skill_name", "instruction_chars"],
  "lifecycle.eval.decision": ["evaluator", "action", "regeneration_count"],
  "lifecycle.eval.skipped": ["evaluator", "reason"],
  "lifecycle.eval.lint": ["files"],
  "lifecycle.eval.guard_recovery": ["mode"],
  "lifecycle.eval.repeated_failure": ["signature", "count", "code", "category"],
  "lifecycle.eval.verify_cycle": ["used_write_tools", "verified", "verify_scope"],
  "lifecycle.eval.verify_failure": ["text_chars"],
  "lifecycle.eval.tool_recovery": ["recovery_tool", "recovery_kind"],
  "lifecycle.summary": [
    "model_calls",
    "total_tool_calls",
    { key: "read_calls", label: "read" },
    { key: "search_calls", label: "search" },
    { key: "write_calls", label: "write" },
    { key: "pre_write_discovery_calls", label: "pre_write_discovery" },
    { key: "regeneration_count", label: "regenerations" },
    { key: "guard_blocked_count", label: "guard_blocked" },
    { key: "guard_flag_set_count", label: "guard_flag_set" },
    "has_error",
  ],
};

const KNOWN_EVENTS = new Set<string>(traceEventSchema.options);

/** Events hidden from `acolyte trace task` unless --verbose is passed. */
const VERBOSE_ONLY_EVENTS = new Set<string>(["lifecycle.tool.output", "lifecycle.tool.cache"]);

function traceRowData(line: LogLine): Record<string, string | undefined> {
  const event = line.fields.event;
  const data: Record<string, string | undefined> = {
    timestamp: line.timestamp,
    task_id: line.taskId,
  };

  if (!event) {
    data.msg = line.fields.msg ?? "log";
    return data;
  }

  data.event = event;

  if (KNOWN_EVENTS.has(event)) {
    const specs = EVENT_FIELDS[event as TraceEvent];
    for (const spec of specs) {
      const key = typeof spec === "string" ? spec : spec.key;
      const label = typeof spec === "string" ? spec : spec.label;
      data[label] = line.fields[key];
    }
  } else if (event.startsWith("lifecycle.memory.")) {
    data.reason = line.fields.reason;
  }

  return data;
}

function parseTaskIdsArg(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    ),
  );
}

export async function traceMode(args: string[], deps: TraceModeDeps): Promise<void> {
  const { hasHelpFlag, traceStore, printDim, printError, commandHelp, commandError } = deps;

  if (hasHelpFlag(args)) {
    commandHelp("trace");
    return;
  }

  if (!traceStore) {
    printError(t("cli.trace.no_store"));
    return;
  }

  const tailCount = parseTailCount(parseFlag(args, ["--lines", "-n"]));
  const verbose = hasBoolFlag(args, "--verbose");
  const out = hasBoolFlag(args, "--json") ? createJsonOutput() : createTextOutput();

  const positional = parsePositional(args, ["--lines", "-n"]);
  const subcommand = positional[0];
  const subcommandArg = positional[1];

  if (subcommand === "task") {
    let taskIds = parseTaskIdsArg(subcommandArg);
    if (taskIds.length === 0) {
      const latest = traceStore.listTasks(1)[0];
      if (!latest) {
        printDim(t("cli.trace.no_tasks"));
        return;
      }
      taskIds = [latest.taskId];
    }
    for (let i = 0; i < taskIds.length; i++) {
      const taskId = taskIds[i];
      if (!taskId) continue;
      const lines = traceStore.listByTaskId(taskId);
      if (lines.length === 0) {
        printDim(t("cli.trace.no_lines_for_task", { taskId }));
        continue;
      }
      if (i > 0) out.addSeparator();
      for (const line of lines) {
        if (!verbose && line.fields.event && VERBOSE_ONLY_EVENTS.has(line.fields.event)) continue;
        out.addRow(traceRowData(line));
      }
    }
  } else if (!subcommand || subcommand === "list") {
    const tasks = traceStore.listTasks(tailCount);
    if (tasks.length === 0) {
      printDim(t("cli.trace.no_tasks"));
    } else {
      out.addTable(
        tasks.map((task) => ({
          task_id: task.taskId,
          model: task.model ?? "unknown",
          status: task.hasError ? "error" : "ok",
          time: formatRelativeTime(task.timestamp),
        })),
        {
          task_id: t("cli.trace.col.task_id"),
          model: t("cli.trace.col.model"),
          status: t("cli.trace.col.status"),
          time: t("cli.trace.col.time"),
        },
      );
    }
  } else {
    commandError("trace", t("cli.trace.unknown_subcommand", { subcommand }));
    return;
  }

  const rendered = out.render();
  if (rendered) printDim(rendered);
}
