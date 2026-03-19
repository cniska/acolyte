import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_LOG_PATH = join(homedir(), ".acolyte", "server.log");

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export type TraceModeDeps = {
  hasHelpFlag: (args: string[]) => boolean;
  printDim: (message: string) => void;
  printError: (message: string) => void;
  commandError: (name: string, message?: string) => void;
  commandHelp: (name: string) => void;
};

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
    return `${ts}${taskPrefix} ${event} model=${model} tool_calls=${toolCalls}`;
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

  if (event.startsWith("lifecycle.eval.")) {
    const evaluator = parseField(line, "evaluator") ?? "?";
    const action = parseField(line, "action") ?? "?";
    const targetPath = parseField(line, "target_path");
    const regen = parseField(line, "regeneration_count");
    return `${ts}${taskPrefix} ${event} evaluator=${evaluator} action=${action}${targetPath ? ` target_path=${targetPath}` : ""}${regen ? ` regeneration_count=${regen}` : ""}`;
  }

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
// Subcommands
// ---------------------------------------------------------------------------

function traceByTask(lines: string[], taskIds: string[], printDim: (msg: string) => void): void {
  for (let i = 0; i < taskIds.length; i += 1) {
    const taskId = taskIds[i];
    const selected = lines.filter((line) => line.includes(`task_id=${taskId}`));
    if (selected.length === 0) {
      printDim(`No lines found for task_id=${taskId}`);
      continue;
    }
    if (i > 0) printDim("");
    printDim(`task_id=${taskId}`);
    for (const line of selected) printDim(compactLine(line));
  }
}

function traceByRequest(lines: string[], requestId: string, printDim: (msg: string) => void): void {
  const selected = lines.filter((line) => line.includes(`request_id=${requestId}`));
  if (selected.length === 0) {
    printDim(`No lines found for request_id=${requestId}`);
    return;
  }
  printDim(`request_id=${requestId}`);
  for (const line of selected) printDim(compactLine(line));
}

function traceTail(lines: string[], count: number, printDim: (msg: string) => void): void {
  const tail = lines.slice(-count);
  printDim(`Showing latest ${tail.length} lines`);
  for (const line of tail) printDim(compactLine(line));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function traceMode(args: string[], deps: TraceModeDeps): Promise<void> {
  const { hasHelpFlag, printDim, printError, commandHelp, commandError } = deps;

  if (hasHelpFlag(args)) {
    commandHelp("trace");
    return;
  }

  const logPath = parseFlag(args, "--log") ?? DEFAULT_LOG_PATH;
  const tailCountRaw = parseFlag(args, ["--lines", "-n"]);
  const tailCount = tailCountRaw ? Math.max(1, Number.parseInt(tailCountRaw, 10) || 40) : 40;

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
    raw = await readFile(logPath, "utf8");
  } catch {
    printError(`Cannot read log file: ${logPath}`);
    return;
  }

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  if (subcommand === "task") {
    const taskIds = parseTaskIdsArg(subcommandArg);
    if (taskIds.length === 0) {
      commandError("trace", "Missing task ID. Usage: acolyte trace task <id>[,<id>]");
      return;
    }
    traceByTask(lines, taskIds, printDim);
    return;
  }

  if (subcommand === "request") {
    if (!subcommandArg) {
      commandError("trace", "Missing request ID. Usage: acolyte trace request <id>");
      return;
    }
    traceByRequest(lines, subcommandArg, printDim);
    return;
  }

  if (subcommand) {
    commandError("trace", `Unknown subcommand: ${subcommand}`);
    return;
  }

  // Default: find latest task_id → fallback to latest err_ request → tail N lines
  const latestTaskId = [...lines]
    .reverse()
    .map((line) => parseTaskId(line))
    .find((value) => value && value.length > 0);

  if (latestTaskId) {
    traceByTask(lines, [latestTaskId], printDim);
    return;
  }

  const latestErrRequest = [...lines]
    .reverse()
    .map((line) => parseRequestId(line))
    .find((value) => value?.startsWith("err_"));

  if (latestErrRequest) {
    traceByRequest(lines, latestErrRequest, printDim);
    return;
  }

  traceTail(lines, tailCount, printDim);
}
