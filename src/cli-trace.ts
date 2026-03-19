import { homedir } from "node:os";
import { join } from "node:path";
import { t } from "./i18n";

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

type TraceModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  logPath: string;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

export const DEFAULT_LOG_PATH = join(homedir(), ".acolyte", "server.log");

// ---------------------------------------------------------------------------
// Log-line parsing
// ---------------------------------------------------------------------------

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseField(line: string, key: string): string | undefined {
  const escapedKey = escapeRegex(key);
  const quoted = line.match(new RegExp(`(?:^|\\s)${escapedKey}="((?:[^"\\\\]|\\\\.)*)"`));
  if (quoted?.[1] !== undefined) return quoted[1];
  const plain = line.match(new RegExp(`(?:^|\\s)${escapedKey}=([^\\s]+)`));
  return plain?.[1];
}

export function parseTimestamp(line: string): string {
  const firstSpace = line.indexOf(" ");
  return firstSpace > 0 ? line.slice(0, firstSpace) : line;
}

export function parseRequestId(line: string): string | undefined {
  return line.match(/\brequest_id=([^\s]+)/)?.[1];
}

export function parseTaskId(line: string): string | undefined {
  const value = line.match(/\btask_id=([^\s]+)/)?.[1];
  if (!value || value === "null") return undefined;
  return value;
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

const FIELD_RE = /(?:^|\s)([a-z_][a-z0-9_]*)=(?:"((?:[^"\\]|\\.)*)"|([^\s]+))/g;

export function parseAllFields(line: string): Record<string, string> {
  const fields: Record<string, string> = {};
  fields.timestamp = parseTimestamp(line);
  for (const match of line.matchAll(FIELD_RE)) {
    fields[match[1]] = match[2] ?? match[3];
  }
  return fields;
}

// ---------------------------------------------------------------------------
// ID matching (word-boundary safe)
// ---------------------------------------------------------------------------

function matchesTaskId(line: string, taskId: string): boolean {
  return new RegExp(`\\btask_id=${escapeRegex(taskId)}(?:\\s|$)`).test(line);
}

function matchesRequestId(line: string, requestId: string): boolean {
  return new RegExp(`\\brequest_id=${escapeRegex(requestId)}(?:\\s|$)`).test(line);
}

// ---------------------------------------------------------------------------
// Compact formatters
// ---------------------------------------------------------------------------

export function compactLine(line: string): string {
  const ts = parseTimestamp(line);
  const taskId = parseTaskId(line);
  const taskPrefix = taskId ? ` task_id=${taskId}` : "";
  const msg = parseField(line, "msg");
  const event = parseField(line, "event");

  // --- msg-based lines ---

  if (msg === "task state updated") {
    const from = parseField(line, "from_state") ?? "null";
    const to = parseField(line, "to_state") ?? "?";
    const reason = parseField(line, "reason") ?? "?";
    const transport = parseField(line, "transport") ?? "?";
    return `${ts}${taskPrefix} state from=${from} to=${to} reason=${reason} transport=${transport}`;
  }

  if (msg === "rpc task accepted") {
    const session = parseField(line, "session_id") ?? "?";
    const queued = parseField(line, "queued_task_count") ?? "?";
    const hasRunning = parseField(line, "has_running_task") ?? "?";
    return `${ts}${taskPrefix} accepted session=${session} queued=${queued} has_running=${hasRunning}`;
  }

  if (msg === "rpc task queued") {
    const position = parseField(line, "queue_position") ?? "?";
    const runningTaskId = parseField(line, "running_task_id") ?? "none";
    return `${ts}${taskPrefix} queued position=${position} running_task_id=${runningTaskId}`;
  }

  if (msg === "rpc task dequeued") return `${ts}${taskPrefix} dequeued`;

  if (msg === "rpc worker task scheduled") {
    const session = parseField(line, "session_id") ?? "?";
    const queued = parseField(line, "queued_task_count") ?? "?";
    return `${ts}${taskPrefix} worker_scheduled session=${session} queued=${queued}`;
  }

  if (msg === "rpc task started") {
    const session = parseField(line, "session_id") ?? "?";
    return `${ts}${taskPrefix} rpc_started session=${session}`;
  }

  if (msg === "chat request started") {
    const model = parseField(line, "model") ?? "?";
    const mode = parseField(line, "workspace_mode") ?? "?";
    const chars = parseField(line, "message_chars") ?? "?";
    return `${ts}${taskPrefix} start model=${model} workspace_mode=${mode} message_chars=${chars}`;
  }

  if (msg === "chat request completed") {
    const duration = parseField(line, "duration_ms") ?? "?";
    const modelCalls = parseField(line, "model_calls") ?? "?";
    const toolCount = parseField(line, "tool_count") ?? "?";
    return `${ts}${taskPrefix} completed duration_ms=${duration} model_calls=${modelCalls} tool_count=${toolCount}`;
  }

  if (!event) return `${ts}${taskPrefix}${msg ? ` ${msg}` : " log"}`;

  // --- lifecycle event lines ---

  if (event === "lifecycle.start") {
    const mode = parseField(line, "mode") ?? "?";
    const model = parseField(line, "model") ?? "?";
    return `${ts}${taskPrefix} ${event} mode=${mode} model=${model}`;
  }

  if (event === "lifecycle.classify") {
    const mode = parseField(line, "mode") ?? "?";
    const model = parseField(line, "model") ?? "?";
    const provider = parseField(line, "provider") ?? "?";
    return `${ts}${taskPrefix} ${event} mode=${mode} model=${model} provider=${provider}`;
  }

  if (event === "lifecycle.prepare") {
    const model = parseField(line, "model") ?? "?";
    const mode = parseField(line, "mode") ?? "?";
    const historyMessages = parseField(line, "history_messages") ?? "?";
    return `${ts}${taskPrefix} ${event} mode=${mode} model=${model} history_messages=${historyMessages}`;
  }

  if (event === "lifecycle.mode.changed") {
    const from = parseField(line, "from") ?? "?";
    const to = parseField(line, "to") ?? "?";
    const trigger = parseField(line, "trigger");
    return `${ts}${taskPrefix} ${event} from=${from} to=${to}${trigger ? ` trigger=${trigger}` : ""}`;
  }

  if (event === "lifecycle.agent.reconfigured") {
    const fromMode = parseField(line, "from_mode") ?? "?";
    const toMode = parseField(line, "to_mode") ?? "?";
    const fromModel = parseField(line, "from_model") ?? "?";
    const toModel = parseField(line, "to_model") ?? "?";
    return `${ts}${taskPrefix} ${event} from_mode=${fromMode} to_mode=${toMode} from_model=${fromModel} to_model=${toModel}`;
  }

  if (event === "lifecycle.generate.start") {
    const model = parseField(line, "model") ?? "?";
    const mode = parseField(line, "mode") ?? "?";
    return `${ts}${taskPrefix} ${event} model=${model} mode=${mode}`;
  }

  if (event === "lifecycle.generate.done") {
    const model = parseField(line, "model") ?? "?";
    const toolCalls = parseField(line, "tool_calls") ?? "?";
    const textChars = parseField(line, "text_chars") ?? "?";
    return `${ts}${taskPrefix} ${event} model=${model} tool_calls=${toolCalls} text_chars=${textChars}`;
  }

  if (event === "lifecycle.generate.error") {
    const model = parseField(line, "model") ?? "?";
    const error = parseField(line, "error") ?? "unknown";
    return `${ts}${taskPrefix} ${event} model=${model} error="${error}"`;
  }

  if (event === "lifecycle.error") {
    const source = parseField(line, "source") ?? "?";
    const kind = parseField(line, "kind") ?? "?";
    const code = parseField(line, "code") ?? "?";
    const category = parseField(line, "category") ?? "?";
    const tool = parseField(line, "tool");
    return `${ts}${taskPrefix} ${event} source=${source} kind=${kind} code=${code} category=${category}${tool ? ` tool=${tool}` : ""}`;
  }

  if (event === "lifecycle.yield") {
    const attempt = parseField(line, "generation_attempt") ?? "?";
    return `${ts}${taskPrefix} ${event} generation_attempt=${attempt}`;
  }

  if (event === "lifecycle.tool.call") {
    const tool = parseField(line, "tool") ?? "?";
    const path = parseField(line, "path");
    const paths = parseField(line, "paths");
    const pattern = parseField(line, "pattern");
    const command = parseField(line, "command");
    return `${ts}${taskPrefix} ${event} tool=${tool}${path ? ` path=${path}` : ""}${paths ? ` paths=${paths}` : ""}${pattern ? ` pattern=${pattern}` : ""}${command ? ` command="${command}"` : ""}`;
  }

  if (event === "lifecycle.tool.cache") {
    const tool = parseField(line, "tool") ?? "?";
    const hit = parseField(line, "hit") ?? "?";
    const hits = parseField(line, "hits") ?? "?";
    const misses = parseField(line, "misses") ?? "?";
    const size = parseField(line, "size") ?? "?";
    return `${ts}${taskPrefix} ${event} tool=${tool} hit=${hit} hits=${hits} misses=${misses} size=${size}`;
  }

  if (event === "lifecycle.tool.result") {
    const tool = parseField(line, "tool") ?? "?";
    const duration = parseField(line, "duration_ms") ?? "?";
    const isError = parseField(line, "is_error") ?? "?";
    return `${ts}${taskPrefix} ${event} tool=${tool} duration_ms=${duration} is_error=${isError}`;
  }

  if (event === "lifecycle.tool.error") {
    const tool = parseField(line, "tool") ?? "?";
    const error = parseField(line, "error") ?? "unknown";
    return `${ts}${taskPrefix} ${event} tool=${tool} error="${error}"`;
  }

  if (event === "lifecycle.tool.output") {
    const tool = parseField(line, "tool") ?? "?";
    return `${ts}${taskPrefix} ${event} tool=${tool}`;
  }

  if (event === "lifecycle.guard") {
    const guard = parseField(line, "guard") ?? "?";
    const tool = parseField(line, "tool") ?? "?";
    const action = parseField(line, "action") ?? "?";
    const detail = parseField(line, "detail");
    return `${ts}${taskPrefix} ${event} guard=${guard} tool=${tool} action=${action}${detail ? ` detail=${detail}` : ""}`;
  }

  if (event === "lifecycle.signal.accepted") {
    const signal = parseField(line, "signal") ?? "?";
    const mode = parseField(line, "mode") ?? "?";
    return `${ts}${taskPrefix} ${event} signal=${signal} mode=${mode}`;
  }

  if (event === "lifecycle.skill.context") {
    const skillName = parseField(line, "skill_name") ?? "?";
    const chars = parseField(line, "instruction_chars") ?? "?";
    return `${ts}${taskPrefix} ${event} skill_name=${skillName} instruction_chars=${chars}`;
  }

  // --- eval sub-events (specific before catch-all) ---

  if (event === "lifecycle.eval.decision") {
    const evaluator = parseField(line, "evaluator") ?? "?";
    const action = parseField(line, "action") ?? "?";
    const regen = parseField(line, "regeneration_count");
    return `${ts}${taskPrefix} ${event} evaluator=${evaluator} action=${action}${regen ? ` regeneration_count=${regen}` : ""}`;
  }

  if (event === "lifecycle.eval.skipped") {
    const evaluator = parseField(line, "evaluator");
    const reason = parseField(line, "reason") ?? "?";
    return `${ts}${taskPrefix} ${event}${evaluator ? ` evaluator=${evaluator}` : ""} reason=${reason}`;
  }

  if (event === "lifecycle.eval.lint") {
    const files = parseField(line, "files") ?? "?";
    return `${ts}${taskPrefix} ${event} files=${files}`;
  }

  if (event === "lifecycle.eval.guard_recovery") {
    const mode = parseField(line, "mode") ?? "?";
    return `${ts}${taskPrefix} ${event} mode=${mode}`;
  }

  if (event === "lifecycle.eval.repeated_failure") {
    const signature = parseField(line, "signature") ?? "?";
    const count = parseField(line, "count") ?? "?";
    const code = parseField(line, "code");
    const category = parseField(line, "category");
    return `${ts}${taskPrefix} ${event} signature=${signature} count=${count}${code ? ` code=${code}` : ""}${category ? ` category=${category}` : ""}`;
  }

  if (event === "lifecycle.eval.verify_failure") {
    const textChars = parseField(line, "text_chars") ?? "?";
    return `${ts}${taskPrefix} ${event} text_chars=${textChars}`;
  }

  if (event === "lifecycle.eval.tool_recovery") {
    const recoveryTool = parseField(line, "recovery_tool") ?? "?";
    const recoveryKind = parseField(line, "recovery_kind") ?? "?";
    return `${ts}${taskPrefix} ${event} recovery_tool=${recoveryTool} recovery_kind=${recoveryKind}`;
  }

  if (event.startsWith("lifecycle.eval.")) {
    return `${ts}${taskPrefix} ${event}`;
  }

  // --- memory events ---

  if (event.startsWith("lifecycle.memory.")) {
    const reason = parseField(line, "reason");
    return `${ts}${taskPrefix} ${event}${reason ? ` reason=${reason}` : ""}`;
  }

  if (event === "lifecycle.summary") {
    const modelCalls = parseField(line, "model_calls") ?? "?";
    const totalCalls = parseField(line, "total_tool_calls") ?? "?";
    const readCalls = parseField(line, "read_calls") ?? "?";
    const searchCalls = parseField(line, "search_calls") ?? "?";
    const writeCalls = parseField(line, "write_calls") ?? "?";
    const preWriteDiscovery = parseField(line, "pre_write_discovery_calls") ?? "?";
    const regens = parseField(line, "regeneration_count") ?? "?";
    const guardBlocked = parseField(line, "guard_blocked_count") ?? "?";
    const guardFlagSet = parseField(line, "guard_flag_set_count") ?? "?";
    const hasError = parseField(line, "has_error") ?? "?";
    return `${ts}${taskPrefix} ${event} model_calls=${modelCalls} total_tool_calls=${totalCalls} read=${readCalls} search=${searchCalls} write=${writeCalls} pre_write_discovery=${preWriteDiscovery} regenerations=${regens} guard_blocked=${guardBlocked} guard_flag_set=${guardFlagSet} has_error=${hasError}`;
  }

  return `${ts}${taskPrefix} ${event}`;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Reverse search helpers (avoid copying entire array)
// ---------------------------------------------------------------------------

function findLastTaskId(lines: string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const id = parseTaskId(lines[i]);
    if (id) return id;
  }
  return undefined;
}

function findLastErrRequestId(lines: string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const id = parseRequestId(lines[i]);
    if (id?.startsWith("err_")) return id;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

type FormatLine = (line: string) => string;

function formatCompact(line: string): string {
  return compactLine(line);
}

function formatJson(line: string): string {
  return JSON.stringify(parseAllFields(line));
}

function traceByTask(lines: string[], taskIds: string[], print: (msg: string) => void, fmt: FormatLine): void {
  for (let i = 0; i < taskIds.length; i += 1) {
    const taskId = taskIds[i];
    const selected = lines.filter((line) => matchesTaskId(line, taskId));
    if (selected.length === 0) {
      print(t("cli.trace.no_lines_for_task", { taskId }));
      continue;
    }
    if (i > 0) print("");
    if (fmt === formatCompact) print(`task_id=${taskId}`);
    for (const line of selected) print(fmt(line));
  }
}

function traceByRequest(lines: string[], requestId: string, print: (msg: string) => void, fmt: FormatLine): void {
  const selected = lines.filter((line) => matchesRequestId(line, requestId));
  if (selected.length === 0) {
    print(t("cli.trace.no_lines_for_request", { requestId }));
    return;
  }
  if (fmt === formatCompact) print(`request_id=${requestId}`);
  for (const line of selected) print(fmt(line));
}

function traceTail(lines: string[], count: number, print: (msg: string) => void, fmt: FormatLine): void {
  const tail = lines.slice(-count);
  if (fmt === formatCompact) print(t("cli.trace.showing_latest", { count: String(tail.length) }));
  for (const line of tail) print(fmt(line));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function traceMode(args: string[], deps: TraceModeDeps): Promise<void> {
  const { hasHelpFlag, logPath, printDim, printError, readFile, commandHelp, commandError } = deps;

  if (hasHelpFlag(args)) {
    commandHelp("trace");
    return;
  }

  const logPathOverride = parseFlag(args, "--log") ?? logPath;
  const tailCount = parseTailCount(parseFlag(args, ["--lines", "-n"]));
  const jsonOutput = args.includes("--json");
  const fmt = jsonOutput ? formatJson : formatCompact;

  // Strip flags from args to get positional arguments
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--log" || args[i] === "--lines" || args[i] === "-n") {
      i++; // skip value
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

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  if (subcommand === "task") {
    const taskIds = parseTaskIdsArg(subcommandArg);
    if (taskIds.length === 0) {
      commandError("trace", t("cli.trace.missing_task_id"));
      return;
    }
    traceByTask(lines, taskIds, printDim, fmt);
    return;
  }

  if (subcommand === "request") {
    if (!subcommandArg) {
      commandError("trace", t("cli.trace.missing_request_id"));
      return;
    }
    traceByRequest(lines, subcommandArg, printDim, fmt);
    return;
  }

  if (subcommand) {
    commandError("trace", t("cli.trace.unknown_subcommand", { subcommand }));
    return;
  }

  // Default: find latest task_id → fallback to latest err_ request → tail N lines
  const latestTaskId = findLastTaskId(lines);

  if (latestTaskId) {
    traceByTask(lines, [latestTaskId], printDim, fmt);
    return;
  }

  const latestErrRequest = findLastErrRequestId(lines);

  if (latestErrRequest) {
    traceByRequest(lines, latestErrRequest, printDim, fmt);
    return;
  }

  traceTail(lines, tailCount, printDim, fmt);
}
