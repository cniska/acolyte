import { hasBoolFlag, parseFlag, parsePositional, parseTailCount } from "./cli-args";
import { type CliOutput, createJsonOutput, createTextOutput } from "./cli-output";
import { elapsedMs, formatDuration, formatRelativeTime } from "./datetime";
import { t } from "./i18n";
import type { LogLine } from "./log-parser";
import { traceEventDisplayFields } from "./trace-event-catalog";
import type { TraceReader } from "./trace-store";

type TraceModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  traceStore?: TraceReader;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

type FieldSpec = string | { key: string; label: string };

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

  for (const spec of traceEventDisplayFields(event) as FieldSpec[]) {
    const key = typeof spec === "string" ? spec : spec.key;
    const label = typeof spec === "string" ? spec : spec.label;
    data[label] = line.fields[key];
  }

  return data;
}

/** Every stored field, unfiltered: `--json` is the scripted-query interface over the store. */
function jsonRowData(line: LogLine): Record<string, string | undefined> {
  return { timestamp: line.timestamp, ...line.fields };
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

/**
 * A read range is what distinguishes a repeated read of a path from a different slice of it.
 * Only file-read ranges a path — git-log also takes `path` with `limit`, where a range reads as a lie.
 */
function readRange(fields: Record<string, string>): string {
  if (fields.tool !== "file-read") return "";
  if (!fields.offset && !fields.limit) return "";
  const count = fields.limit ? `+${fields.limit}` : "";
  return ` @${fields.offset ?? "1"}${count}`;
}

function extractToolArg(fields: Record<string, string>): string {
  if (fields.path) return `${fields.path}${readRange(fields)}`;
  if (fields.command) return truncate(fields.command, 40);
  if (fields.cmd) return truncate([fields.cmd, ...parsePaths(fields.args ?? "")].join(" "), 40);
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

function compactMemory(fields: Record<string, string>): string {
  const facts =
    Number(fields.project_promoted_facts ?? 0) +
    Number(fields.user_promoted_facts ?? 0) +
    Number(fields.session_scoped_facts ?? 0);
  const parts = [`memory  facts=${facts}`];
  const digest: string[] = [];
  if (fields.activity_files && fields.activity_files !== "0") digest.push(`files=${fields.activity_files}`);
  if (fields.activity_commands && fields.activity_commands !== "0") digest.push(`commands=${fields.activity_commands}`);
  if (fields.activity_errors && fields.activity_errors !== "0") digest.push(`errors=${fields.activity_errors}`);
  if (digest.length > 0) parts.push(`digest (${digest.join(" ")})`);
  if (fields.distill_tokens && fields.distill_tokens !== "0") parts.push(`distill_tokens=${fields.distill_tokens}`);
  return parts.join("  ");
}

function renderCompact(lines: LogLine[], out: CliOutput): void {
  const firstTs = lines[0]?.timestamp;
  const lastTs = lines[lines.length - 1]?.timestamp;
  const startLine = lines.find((l) => l.fields.event === "lifecycle.start");
  const summaryLine = lines.find((l) => l.fields.event === "lifecycle.summary");
  const memoryLine = lines.find(
    (l) => l.fields.event === "lifecycle.memory.commit_done" || l.fields.event === "lifecycle.memory.commit_failed",
  );
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
  if (memoryLine) {
    out.addHeader(
      memoryLine.fields.event === "lifecycle.memory.commit_failed"
        ? `memory  commit failed: ${memoryLine.fields.message ?? "unknown"}`
        : compactMemory(memoryLine.fields),
    );
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
  // `--verbose` shapes human output only; JSON has no verbosity, it carries the whole store.
  const out = isJson ? createJsonOutput() : createTextOutput({ verbose });

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
          out.addRow(isJson ? jsonRowData(line) : verboseRowData(line));
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
