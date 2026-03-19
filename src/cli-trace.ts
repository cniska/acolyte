import { homedir } from "node:os";
import { join } from "node:path";
import { t } from "./i18n";
import {
  field,
  findLastErrRequestId,
  findLastTaskId,
  type LogLine,
  matchesRequestId,
  matchesTaskId,
  parseLog,
} from "./log-parser";

type TraceModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  logPath: string;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

export const DEFAULT_LOG_PATH = join(homedir(), ".acolyte", "daemons", "server.log");

type TraceEvent =
  | "task.state_updated"
  | "rpc.task.accepted"
  | "rpc.task.queued"
  | "rpc.task.dequeued"
  | "rpc.worker.scheduled"
  | "rpc.task.started"
  | "chat.request.started"
  | "chat.request.completed"
  | "lifecycle.start"
  | "lifecycle.classify"
  | "lifecycle.prepare"
  | "lifecycle.mode.changed"
  | "lifecycle.agent.reconfigured"
  | "lifecycle.generate.start"
  | "lifecycle.generate.done"
  | "lifecycle.generate.error"
  | "lifecycle.error"
  | "lifecycle.yield"
  | "lifecycle.tool.call"
  | "lifecycle.tool.cache"
  | "lifecycle.tool.result"
  | "lifecycle.tool.error"
  | "lifecycle.tool.output"
  | "lifecycle.guard"
  | "lifecycle.signal.accepted"
  | "lifecycle.skill.context"
  | "lifecycle.eval.decision"
  | "lifecycle.eval.skipped"
  | "lifecycle.eval.lint"
  | "lifecycle.eval.guard_recovery"
  | "lifecycle.eval.repeated_failure"
  | "lifecycle.eval.verify_failure"
  | "lifecycle.eval.tool_recovery"
  | "lifecycle.summary";

const KNOWN_EVENTS = new Set<string>([
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
  "lifecycle.eval.verify_failure",
  "lifecycle.eval.tool_recovery",
  "lifecycle.summary",
]);

function formatKnownEvent(event: TraceEvent, line: LogLine, ts: string, taskPrefix: string): string {
  const f = (key: string, fallback = "?"): string => field(line, key) ?? fallback;

  switch (event) {
    case "task.state_updated":
      return `${ts}${taskPrefix} ${event} from=${f("from_state", "null")} to=${f("to_state")} reason=${f("reason")} transport=${f("transport")}`;
    case "rpc.task.accepted":
      return `${ts}${taskPrefix} ${event} session=${f("session_id")} queued=${f("queued_task_count")} has_running=${f("has_running_task")}`;
    case "rpc.task.queued":
      return `${ts}${taskPrefix} ${event} position=${f("queue_position")} running_task_id=${f("running_task_id", "none")}`;
    case "rpc.task.dequeued":
      return `${ts}${taskPrefix} ${event}`;
    case "rpc.worker.scheduled":
      return `${ts}${taskPrefix} ${event} session=${f("session_id")} queued=${f("queued_task_count")}`;
    case "rpc.task.started":
      return `${ts}${taskPrefix} ${event} session=${f("session_id")}`;
    case "chat.request.started":
      return `${ts}${taskPrefix} ${event} model=${f("model")} workspace_mode=${f("workspace_mode")} message_chars=${f("message_chars")}`;
    case "chat.request.completed":
      return `${ts}${taskPrefix} ${event} duration_ms=${f("duration_ms")} model_calls=${f("model_calls")} tool_count=${f("tool_count")}`;
    case "lifecycle.start":
      return `${ts}${taskPrefix} ${event} mode=${f("mode")} model=${f("model")}`;
    case "lifecycle.classify":
      return `${ts}${taskPrefix} ${event} mode=${f("mode")} model=${f("model")} provider=${f("provider")}`;
    case "lifecycle.prepare":
      return `${ts}${taskPrefix} ${event} mode=${f("mode")} model=${f("model")} history_messages=${f("history_messages")}`;
    case "lifecycle.mode.changed": {
      const trigger = field(line, "trigger");
      return `${ts}${taskPrefix} ${event} from=${f("from")} to=${f("to")}${trigger ? ` trigger=${trigger}` : ""}`;
    }
    case "lifecycle.agent.reconfigured":
      return `${ts}${taskPrefix} ${event} from_mode=${f("from_mode")} to_mode=${f("to_mode")} from_model=${f("from_model")} to_model=${f("to_model")}`;
    case "lifecycle.generate.start":
      return `${ts}${taskPrefix} ${event} model=${f("model")} mode=${f("mode")}`;
    case "lifecycle.generate.done":
      return `${ts}${taskPrefix} ${event} model=${f("model")} tool_calls=${f("tool_calls")} text_chars=${f("text_chars")}`;
    case "lifecycle.generate.error":
      return `${ts}${taskPrefix} ${event} model=${f("model")} error="${f("error", "unknown")}"`;
    case "lifecycle.error": {
      const tool = field(line, "tool");
      return `${ts}${taskPrefix} ${event} source=${f("source")} kind=${f("kind")} code=${f("code")} category=${f("category")}${tool ? ` tool=${tool}` : ""}`;
    }
    case "lifecycle.yield":
      return `${ts}${taskPrefix} ${event} generation_attempt=${f("generation_attempt")}`;
    case "lifecycle.tool.call": {
      const path = field(line, "path");
      const paths = field(line, "paths");
      const pattern = field(line, "pattern");
      const command = field(line, "command");
      return `${ts}${taskPrefix} ${event} tool=${f("tool")}${path ? ` path=${path}` : ""}${paths ? ` paths=${paths}` : ""}${pattern ? ` pattern=${pattern}` : ""}${command ? ` command="${command}"` : ""}`;
    }
    case "lifecycle.tool.cache":
      return `${ts}${taskPrefix} ${event} tool=${f("tool")} hit=${f("hit")} hits=${f("hits")} misses=${f("misses")} size=${f("size")}`;
    case "lifecycle.tool.result":
      return `${ts}${taskPrefix} ${event} tool=${f("tool")} duration_ms=${f("duration_ms")} is_error=${f("is_error")}`;
    case "lifecycle.tool.error":
      return `${ts}${taskPrefix} ${event} tool=${f("tool")} error="${f("error", "unknown")}"`;
    case "lifecycle.tool.output":
      return `${ts}${taskPrefix} ${event} tool=${f("tool")}`;
    case "lifecycle.guard": {
      const detail = field(line, "detail");
      return `${ts}${taskPrefix} ${event} guard=${f("guard")} tool=${f("tool")} action=${f("action")}${detail ? ` detail=${detail}` : ""}`;
    }
    case "lifecycle.signal.accepted":
      return `${ts}${taskPrefix} ${event} signal=${f("signal")} mode=${f("mode")}`;
    case "lifecycle.skill.context":
      return `${ts}${taskPrefix} ${event} skill_name=${f("skill_name")} instruction_chars=${f("instruction_chars")}`;
    case "lifecycle.eval.decision": {
      const regen = field(line, "regeneration_count");
      return `${ts}${taskPrefix} ${event} evaluator=${f("evaluator")} action=${f("action")}${regen ? ` regeneration_count=${regen}` : ""}`;
    }
    case "lifecycle.eval.skipped": {
      const evaluator = field(line, "evaluator");
      return `${ts}${taskPrefix} ${event}${evaluator ? ` evaluator=${evaluator}` : ""} reason=${f("reason")}`;
    }
    case "lifecycle.eval.lint":
      return `${ts}${taskPrefix} ${event} files=${f("files")}`;
    case "lifecycle.eval.guard_recovery":
      return `${ts}${taskPrefix} ${event} mode=${f("mode")}`;
    case "lifecycle.eval.repeated_failure": {
      const code = field(line, "code");
      const category = field(line, "category");
      return `${ts}${taskPrefix} ${event} signature=${f("signature")} count=${f("count")}${code ? ` code=${code}` : ""}${category ? ` category=${category}` : ""}`;
    }
    case "lifecycle.eval.verify_failure":
      return `${ts}${taskPrefix} ${event} text_chars=${f("text_chars")}`;
    case "lifecycle.eval.tool_recovery":
      return `${ts}${taskPrefix} ${event} recovery_tool=${f("recovery_tool")} recovery_kind=${f("recovery_kind")}`;
    case "lifecycle.summary":
      return `${ts}${taskPrefix} ${event} model_calls=${f("model_calls")} total_tool_calls=${f("total_tool_calls")} read=${f("read_calls")} search=${f("search_calls")} write=${f("write_calls")} pre_write_discovery=${f("pre_write_discovery_calls")} regenerations=${f("regeneration_count")} guard_blocked=${f("guard_blocked_count")} guard_flag_set=${f("guard_flag_set_count")} has_error=${f("has_error")}`;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function compactLine(line: LogLine): string {
  const ts = line.timestamp;
  const taskPrefix = line.taskId ? ` task_id=${line.taskId}` : "";
  const event = field(line, "event");

  if (!event) {
    const msg = field(line, "msg");
    return `${ts}${taskPrefix}${msg ? ` ${msg}` : " log"}`;
  }

  if (KNOWN_EVENTS.has(event)) {
    return formatKnownEvent(event as TraceEvent, line, ts, taskPrefix);
  }

  if (event.startsWith("lifecycle.memory.")) {
    const reason = field(line, "reason");
    return `${ts}${taskPrefix} ${event}${reason ? ` reason=${reason}` : ""}`;
  }

  return `${ts}${taskPrefix} ${event}`;
}

function parseFlag(args: string[], flag: string | string[]): string | undefined {
  const flags = Array.isArray(flag) ? flag : [flag];
  for (const f of flags) {
    const index = args.indexOf(f);
    if (index >= 0 && index + 1 < args.length) return args[index + 1];
  }
  return undefined;
}

function parseTailCount(raw: string | undefined): number {
  if (raw === undefined) return 40;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.max(1, parsed) : 40;
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

type FormatLine = (line: LogLine) => string;

function formatJson(line: LogLine): string {
  return JSON.stringify({ timestamp: line.timestamp, ...line.fields });
}

function traceByTask(
  lines: LogLine[],
  taskIds: string[],
  print: (msg: string) => void,
  fmt: FormatLine,
  json: boolean,
): void {
  for (let i = 0; i < taskIds.length; i += 1) {
    const taskId = taskIds[i];
    const selected = lines.filter((line) => matchesTaskId(line, taskId));
    if (selected.length === 0) {
      print(t("cli.trace.no_lines_for_task", { taskId }));
      continue;
    }
    if (i > 0) print("");
    if (!json) print(`task_id=${taskId}`);
    for (const line of selected) print(fmt(line));
  }
}

function traceByRequest(
  lines: LogLine[],
  requestId: string,
  print: (msg: string) => void,
  fmt: FormatLine,
  json: boolean,
): void {
  const selected = lines.filter((line) => matchesRequestId(line, requestId));
  if (selected.length === 0) {
    print(t("cli.trace.no_lines_for_request", { requestId }));
    return;
  }
  if (!json) print(`request_id=${requestId}`);
  for (const line of selected) print(fmt(line));
}

function traceTail(
  lines: LogLine[],
  count: number,
  print: (msg: string) => void,
  fmt: FormatLine,
  json: boolean,
): void {
  const tail = lines.slice(-count);
  if (!json) print(t("cli.trace.showing_latest", { count: String(tail.length) }));
  for (const line of tail) print(fmt(line));
}

export async function traceMode(args: string[], deps: TraceModeDeps): Promise<void> {
  const { hasHelpFlag, logPath, printDim, printError, readFile, commandHelp, commandError } = deps;

  if (hasHelpFlag(args)) {
    commandHelp("trace");
    return;
  }

  const logPathOverride = parseFlag(args, "--log") ?? logPath;
  const tailCount = parseTailCount(parseFlag(args, ["--lines", "-n"]));
  const jsonOutput = args.includes("--json");
  const fmt: FormatLine = jsonOutput ? formatJson : compactLine;

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--log" || args[i] === "--lines" || args[i] === "-n") {
      i++;
      continue;
    }
    if (args[i].startsWith("-")) continue;
    positional.push(args[i]);
  }

  const subcommand = positional[0];
  const subcommandArg = positional[1];

  let raw: string;
  try {
    raw = await readFile(logPathOverride, "utf8");
  } catch {
    printError(t("cli.trace.cannot_read", { path: logPathOverride }));
    return;
  }

  const lines = parseLog(raw);

  if (subcommand === "task") {
    const taskIds = parseTaskIdsArg(subcommandArg);
    if (taskIds.length === 0) {
      commandError("trace", t("cli.trace.missing_task_id"));
      return;
    }
    traceByTask(lines, taskIds, printDim, fmt, jsonOutput);
    return;
  }

  if (subcommand === "request") {
    if (!subcommandArg) {
      commandError("trace", t("cli.trace.missing_request_id"));
      return;
    }
    traceByRequest(lines, subcommandArg, printDim, fmt, jsonOutput);
    return;
  }

  if (subcommand) {
    commandError("trace", t("cli.trace.unknown_subcommand", { subcommand }));
    return;
  }

  const latestTaskId = findLastTaskId(lines);
  if (latestTaskId) {
    traceByTask(lines, [latestTaskId], printDim, fmt, jsonOutput);
    return;
  }

  const latestErrRequest = findLastErrRequestId(lines);
  if (latestErrRequest) {
    traceByRequest(lines, latestErrRequest, printDim, fmt, jsonOutput);
    return;
  }

  traceTail(lines, tailCount, printDim, fmt, jsonOutput);
}
