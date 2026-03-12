import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DAEMON_LOG_PATH = join(homedir(), ".acolyte", "server.log");

function parseArg(flagOrFlags: string | string[]): string | undefined {
  const flags = Array.isArray(flagOrFlags) ? flagOrFlags : [flagOrFlags];
  for (const flag of flags) {
    const index = Bun.argv.indexOf(flag);
    if (index < 0) continue;
    return Bun.argv[index + 1];
  }
  return undefined;
}

function parseTaskIdsArg(value: string | undefined): string[] {
  if (!value) return [];
  const out = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return Array.from(new Set(out));
}

function parseRequestId(line: string): string | undefined {
  const match = line.match(/\brequest_id=([^\s]+)/);
  return match?.[1];
}

function parseTaskId(line: string): string | undefined {
  const match = line.match(/\btask_id=([^\s]+)/);
  const value = match?.[1];
  if (!value || value === "null") return undefined;
  return value;
}

function parseTimestamp(line: string): string {
  const firstSpace = line.indexOf(" ");
  return firstSpace > 0 ? line.slice(0, firstSpace) : line;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseField(line: string, key: string): string | undefined {
  const escapedKey = escapeRegex(key);
  const quoted = line.match(new RegExp(`(?:^|\\s)${escapedKey}="((?:[^"\\\\]|\\\\.)*)"`));
  if (quoted?.[1] !== undefined) return quoted[1];
  const plain = line.match(new RegExp(`(?:^|\\s)${escapedKey}=([^\\s]+)`));
  return plain?.[1];
}

function compactLine(line: string): string {
  const ts = parseTimestamp(line);
  const taskId = parseTaskId(line);
  const taskPrefix = taskId ? ` task_id=${taskId}` : "";
  const msg = parseField(line, "msg");
  const event = parseField(line, "event");

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

  if (event === "lifecycle.guard") {
    const guard = parseField(line, "guard") ?? "?";
    const tool = parseField(line, "tool") ?? "?";
    const action = parseField(line, "action") ?? "?";
    const detail = parseField(line, "detail");
    return `${ts}${taskPrefix} ${event} guard=${guard} tool=${tool} action=${action}${detail ? ` detail=${detail}` : ""}`;
  }

  if (event.startsWith("lifecycle.eval.")) {
    const evaluator = parseField(line, "evaluator") ?? "?";
    const action = parseField(line, "action") ?? "?";
    const targetPath = parseField(line, "target_path");
    const regen = parseField(line, "regeneration_count");
    return `${ts}${taskPrefix} ${event} evaluator=${evaluator} action=${action}${targetPath ? ` target_path=${targetPath}` : ""}${regen ? ` regeneration_count=${regen}` : ""}`;
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

async function main(): Promise<void> {
  const logPath = parseArg("--log") ?? DAEMON_LOG_PATH;
  const requestedId = parseArg("--request");
  const requestedTaskIds = parseTaskIdsArg(parseArg("--task"));

  const raw = await readFile(logPath, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  if (requestedId && requestedTaskIds.length > 0) {
    throw new Error("Pass either --request or --task, not both.");
  }

  const latestTaskId = [...lines]
    .reverse()
    .map((line) => parseTaskId(line))
    .find((value) => value && value.length > 0);
  const taskIds = requestedTaskIds.length > 0 ? requestedTaskIds : latestTaskId ? [latestTaskId] : [];

  if (taskIds.length > 0) {
    for (let i = 0; i < taskIds.length; i += 1) {
      const taskId = taskIds[i];
      const selected = lines.filter((line) => line.includes(`task_id=${taskId}`));
      if (selected.length === 0) throw new Error(`No lines found for task_id=${taskId} in ${logPath}`);
      if (i > 0) console.log("");
      console.log(`task_id=${taskId}`);
      for (const line of selected) {
        console.log(compactLine(line));
      }
    }
    return;
  }

  const requestId =
    requestedId ??
    [...lines]
      .reverse()
      .map((line) => parseRequestId(line))
      .find((value) => value?.startsWith("err_"));

  if (!requestId) {
    const requestedLines = parseInt(parseArg(["--lines", "-n"]) ?? "", 10);
    const tailCount = Number.isFinite(requestedLines) && requestedLines > 0 ? requestedLines : 40;
    const tail = lines.slice(-tailCount);
    console.log(`no request_id/task_id found in ${logPath}; showing latest ${tail.length} lines`);
    for (const line of tail) {
      console.log(compactLine(line));
    }
    return;
  }

  const selected = lines.filter((line) => line.includes(`request_id=${requestId}`));
  if (selected.length === 0) throw new Error(`No lines found for request_id=${requestId} in ${logPath}`);

  console.log(`request_id=${requestId}`);
  for (const line of selected) {
    console.log(compactLine(line));
  }
}

await main();
