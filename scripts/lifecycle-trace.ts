import { readFile } from "node:fs/promises";

const DEFAULT_LOG_PATH = "/tmp/acolyte-server.log";

function parseArg(flag: string): string | undefined {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return undefined;
  return Bun.argv[index + 1];
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
  const quoted = line.match(new RegExp(`(?:^|\\s)${escapedKey}="([^"]*)"`));
  if (quoted?.[1] !== undefined) return quoted[1];
  const plain = line.match(new RegExp(`(?:^|\\s)${escapedKey}=([^\\s]+)`));
  return plain?.[1];
}

function compactLine(line: string): string {
  const ts = parseTimestamp(line);
  const msg = parseField(line, "msg");
  const event = parseField(line, "event");

  if (msg === "chat request started") {
    const model = parseField(line, "model") ?? "?";
    const mode = parseField(line, "workspace_mode") ?? "?";
    const chars = parseField(line, "message_chars") ?? "?";
    return `${ts} start model=${model} workspace_mode=${mode} message_chars=${chars}`;
  }

  if (msg === "chat request completed") {
    const duration = parseField(line, "duration_ms") ?? "?";
    const modelCalls = parseField(line, "model_calls") ?? "?";
    const toolCount = parseField(line, "tool_count") ?? "?";
    return `${ts} completed duration_ms=${duration} model_calls=${modelCalls} tool_count=${toolCount}`;
  }

  if (!event) return `${ts} ${line}`;

  if (event === "lifecycle.tool.call") {
    const tool = parseField(line, "tool") ?? "?";
    const path = parseField(line, "path");
    const pattern = parseField(line, "pattern");
    const command = parseField(line, "command");
    return `${ts} ${event} tool=${tool}${path ? ` path=${path}` : ""}${pattern ? ` pattern=${pattern}` : ""}${command ? ` command="${command}"` : ""}`;
  }

  if (event === "lifecycle.tool.result") {
    const tool = parseField(line, "tool") ?? "?";
    const duration = parseField(line, "duration_ms") ?? "?";
    const isError = parseField(line, "is_error") ?? "?";
    return `${ts} ${event} tool=${tool} duration_ms=${duration} is_error=${isError}`;
  }

  if (event === "lifecycle.tool.error") {
    const tool = parseField(line, "tool") ?? "?";
    const error = parseField(line, "error") ?? "unknown";
    return `${ts} ${event} tool=${tool} error="${error}"`;
  }

  if (event.startsWith("lifecycle.eval.")) {
    const evaluator = parseField(line, "evaluator") ?? "?";
    const action = parseField(line, "action") ?? "?";
    const targetPath = parseField(line, "target_path");
    const regen = parseField(line, "regeneration_count");
    return `${ts} ${event} evaluator=${evaluator} action=${action}${targetPath ? ` target_path=${targetPath}` : ""}${regen ? ` regeneration_count=${regen}` : ""}`;
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
    return `${ts} ${event} model_calls=${modelCalls} total_tool_calls=${totalCalls} read=${readCalls} search=${searchCalls} write=${writeCalls} pre_write_discovery=${preWriteDiscovery} regenerations=${regens} guard_blocked=${guardBlocked} guard_flag_set=${guardFlagSet} has_error=${hasError}`;
  }

  return `${ts} ${event}`;
}

async function main(): Promise<void> {
  const logPath = parseArg("--log") ?? DEFAULT_LOG_PATH;
  const requestedId = parseArg("--request");
  const requestedTaskId = parseArg("--task");

  const raw = await readFile(logPath, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);

  if (requestedId && requestedTaskId) {
    throw new Error("Pass either --request or --task, not both.");
  }

  const taskId =
    requestedTaskId ??
    [...lines]
      .reverse()
      .map((line) => parseTaskId(line))
      .find((value) => value && value.length > 0);

  if (requestedTaskId || taskId) {
    if (!taskId) throw new Error(`No task_id found in ${logPath}`);
    const selected = lines.filter((line) => line.includes(`task_id=${taskId}`));
    if (selected.length === 0) throw new Error(`No lines found for task_id=${taskId} in ${logPath}`);
    console.log(`task_id=${taskId}`);
    for (const line of selected) {
      console.log(compactLine(line));
    }
    return;
  }

  const requestId =
    requestedId ??
    [...lines]
      .reverse()
      .map((line) => parseRequestId(line))
      .find((value) => value?.startsWith("err_"));

  if (!requestId) throw new Error(`No request_id found in ${logPath}`);

  const selected = lines.filter((line) => line.includes(`request_id=${requestId}`));
  if (selected.length === 0) throw new Error(`No lines found for request_id=${requestId} in ${logPath}`);

  console.log(`request_id=${requestId}`);
  for (const line of selected) {
    console.log(compactLine(line));
  }
}

await main();
