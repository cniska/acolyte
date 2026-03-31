import type { LifecycleSignal, RunContext } from "./lifecycle-contract";
import { WRITE_TOOL_SET } from "./tool-registry";
import { scopedCallLog } from "./tool-session";

export function acceptedLifecycleSignal(ctx: RunContext): LifecycleSignal | undefined {
  const signal = ctx.result?.signal;
  if (!signal) return undefined;
  if (ctx.currentError) return undefined;
  if (signal === "no_op" && taskHasWrites(ctx)) return undefined;
  if (signal === "done" || signal === "no_op" || signal === "blocked") return signal;
  return undefined;
}

function taskHasWrites(ctx: RunContext): boolean {
  return scopedCallLog(ctx.session, ctx.taskId).some((entry) => WRITE_TOOL_SET.has(entry.toolName));
}
