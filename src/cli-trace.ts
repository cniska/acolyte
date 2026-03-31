import { z } from "zod";
import { hasBoolFlag, parseFlag, parsePositional, parseTailCount } from "./cli-args";
import { type CliOutput, createJsonOutput, createTextOutput } from "./cli-output";
import { elapsedMs, formatDuration, formatRelativeTime } from "./datetime";
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
  "lifecycle.workspace.profile",
  "lifecycle.start",
  "lifecycle.prepare",
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
  "lifecycle.budget",
  "lifecycle.signal.accepted",
  "lifecycle.skill.context",
  "lifecycle.effect.format",
  "lifecycle.effect.lint",
  "lifecycle.effect.lint.output",
  "lifecycle.eval.decision",
  "lifecycle.eval.skipped",
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
  "lifecycle.workspace.profile": [
    "ecosystem",
    "package_manager",
    "lint_command",
    "format_command",
    "test_command",
    "line_width",
  ],
  "lifecycle.start": ["model"],
  "lifecycle.prepare": ["model", "history_messages"],
  "lifecycle.generate.start": ["model"],
  "lifecycle.generate.done": ["model", "tool_calls", "text_chars"],
  "lifecycle.generate.error": ["model", "error"],
  "lifecycle.error": ["source", "kind", "code", "category", "tool"],
  "lifecycle.yield": [],
  "lifecycle.tool.call": ["tool", "path", "paths", "pattern", "command"],
  "lifecycle.tool.cache": ["tool", "hit", "hits", "misses", "size"],
  "lifecycle.tool.result": ["tool", "duration_ms", "is_error"],
  "lifecycle.tool.error": ["tool", "error"],
  "lifecycle.tool.output": ["tool"],
  "lifecycle.budget": ["tool", "action", "detail"],
  "lifecycle.signal.accepted": ["signal"],
  "lifecycle.skill.context": ["skill_name", "instruction_chars"],
  "lifecycle.effect.format": ["files"],
  "lifecycle.effect.lint": ["files"],
  "lifecycle.eval.decision": ["effect", "action"],
  "lifecycle.eval.skipped": ["reason"],
  "lifecycle.effect.lint.output": ["output"],
  "lifecycle.summary": [
    "model_calls",
    { key: "tool_calls", label: "total_tool_calls" },
    { key: "read_calls", label: "read" },
    { key: "search_calls", label: "search" },
    { key: "write_calls", label: "write" },
    { key: "pre_write_discovery_calls", label: "pre_write_discovery" },
    { key: "budget_exhausted_count", label: "budget_exhausted" },
    "has_error",
  ],
};

const KNOWN_EVENTS = new Set<string>(traceEventSchema.options);

const VERBOSE_ONLY_EVENTS = new Set<string>(["lifecycle.tool.output", "lifecycle.tool.cache"]);

function verboseRowData(line: LogLine): Record<string, string | undefined> {
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

type CompactToolLine = {
  tool: string;
  arg: string;
  status: string;
};

function parsePaths(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => (typeof entry === "string" ? entry : entry?.path))
      .filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function extractToolArg(fields: Record<string, string>): string {
  if (fields.path) return fields.path;
  if (fields.command) return truncate(fields.command, 40);
  if (fields.pattern) return `"${fields.pattern}"`;
  if (fields.paths) return parsePaths(fields.paths).join(", ");
  return "";
}

type CompactRow = { kind: "tool"; line: CompactToolLine } | { kind: "separator"; text: string };

/** Right-align the status column in a batch of tool rows by padding with spaces. */
function rightAlignStatus(batch: CompactToolLine[]): Record<string, string>[] {
  const maxStatus = Math.max(0, ...batch.map((r) => r.status.length));
  return batch.map((r) => ({ tool: r.tool, arg: r.arg, status: r.status.padStart(maxStatus) }));
}

function compactSummary(fields: Record<string, string>): string {
  const totalTools = fields.tool_calls ?? "0";
  const parts = [`model_calls=${fields.model_calls ?? "0"}`, `tools=${totalTools}`];
  const breakdown: string[] = [];
  if (fields.read_calls && fields.read_calls !== "0") breakdown.push(`read=${fields.read_calls}`);
  if (fields.search_calls && fields.search_calls !== "0") breakdown.push(`search=${fields.search_calls}`);
  if (fields.write_calls && fields.write_calls !== "0") breakdown.push(`write=${fields.write_calls}`);
  if (breakdown.length > 0) parts[parts.length - 1] += ` (${breakdown.join(" ")})`;
  if (fields.budget_exhausted_count && fields.budget_exhausted_count !== "0")
    parts.push(`budget_exhausted=${fields.budget_exhausted_count}`);
  parts.push(`status=${fields.has_error === "true" ? "error" : "ok"}`);
  return parts.join("  ");
}

function renderCompact(lines: LogLine[], out: CliOutput): void {
  const firstTs = lines[0]?.timestamp;
  const lastTs = lines[lines.length - 1]?.timestamp;
  const startLine = lines.find((l) => l.fields.event === "lifecycle.start");
  const summaryLine = lines.find((l) => l.fields.event === "lifecycle.summary");
  const taskId = lines[0]?.taskId ?? "unknown";
  const model = startLine?.fields.model ?? "unknown";
  const duration = firstTs && lastTs ? formatDuration(elapsedMs(firstTs, lastTs)) : "?";
  out.addHeader(`${taskId}  ${model}  ${duration}`);

  const rows: CompactRow[] = [];
  let pending: CompactToolLine | null = null;

  const flushPending = () => {
    if (!pending) return;
    rows.push({ kind: "tool", line: pending });
    pending = null;
  };

  for (const line of lines) {
    const event = line.fields.event;
    if (!event) continue;

    if (event === "lifecycle.tool.call") {
      flushPending();
      pending = { tool: line.fields.tool ?? "?", arg: extractToolArg(line.fields), status: "" };
      continue;
    }

    if (event === "lifecycle.budget" && pending) {
      pending.status = `BLOCKED  budget`;
      flushPending();
      continue;
    }

    if (event === "lifecycle.tool.result" && pending) {
      const ms = line.fields.duration_ms;
      pending.status = ms && Number(ms) >= 120_000 ? `TIMEOUT ${Math.round(Number(ms) / 1000)}s` : ms ? `${ms}ms` : "";
      flushPending();
      continue;
    }

    if (event === "lifecycle.eval.decision") continue;

    if (event === "lifecycle.eval.skipped") {
      flushPending();
      rows.push({
        kind: "separator",
        text: `── stopped (${line.fields.reason ?? ""}) ──`,
      });
      continue;
    }

    if (event === "lifecycle.signal.accepted" && line.fields.signal !== "done") {
      rows.push({ kind: "separator", text: `@signal ${line.fields.signal ?? "?"}` });
    }
  }

  flushPending();

  // Flush tool rows as tables, interleaving separators.
  let batch: CompactToolLine[] = [];
  const flushBatch = () => {
    if (batch.length === 0) return;
    out.addTable(rightAlignStatus(batch));
    batch = [];
  };
  let hasBody = false;
  for (const row of rows) {
    if (!hasBody) {
      out.addSeparator();
      hasBody = true;
    }
    if (row.kind === "tool") {
      batch.push(row.line);
    } else {
      flushBatch();
      out.addHeader(row.text);
    }
  }
  flushBatch();

  if (summaryLine) {
    out.addSeparator();
    out.addHeader(compactSummary(summaryLine.fields));
  }
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
  const isJson = hasBoolFlag(args, "--json");
  const out = isJson ? createJsonOutput({ verbose }) : createTextOutput({ verbose });

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
      if (out.verbose || isJson) {
        for (const line of lines) {
          if (!out.verbose && line.fields.event && VERBOSE_ONLY_EVENTS.has(line.fields.event)) continue;
          out.addRow(verboseRowData(line));
        }
      } else {
        renderCompact(lines, out);
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
          status: task.hasError ? "error" : task.lifecycleSignal === "blocked" ? "blocked" : "ok",
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
