import type { LifecycleSignal, RunContext } from "./lifecycle-contract";
import { scopedCallLog } from "./tool-guards";
import { WRITE_TOOL_SET } from "./tool-registry";

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

export function clearVerifyOutcomeForFeedback(ctx: RunContext, feedbackSource?: string): void {
  if (feedbackSource === "verify") ctx.lifecycleState.verifyOutcome = undefined;
}

export function updateRepeatedFailureState(ctx: RunContext): void {
  const signature = failureSignatureForError(ctx);
  if (!signature) {
    ctx.lifecycleState.repeatedFailure = undefined;
    return;
  }

  const previous = ctx.lifecycleState.repeatedFailure;
  if (!previous || previous.signature !== signature) {
    ctx.lifecycleState.repeatedFailure = { signature, count: 1, status: "pending" };
    return;
  }

  ctx.lifecycleState.repeatedFailure = { ...previous, count: previous.count + 1 };
}

function failureSignatureForError(ctx: RunContext): string | undefined {
  if (!ctx.currentError) return undefined;
  const code = ctx.currentError.code ?? "unknown";
  const category = ctx.currentError.category ?? "other";
  const source = ctx.currentError.source ?? "generate";
  const tool = ctx.currentError.tool ?? "none";
  const attempt = failureAttemptDiscriminator(ctx, tool);
  return [category, source, tool, code, attempt].join(":");
}

function failureAttemptDiscriminator(ctx: RunContext, toolName: string): string {
  if (toolName !== "none") {
    const argsSignature = lastToolArgsSignature(ctx, toolName);
    if (argsSignature) return `args=${argsSignature}`;
  }

  const message = normalizeFailureMessage(ctx.currentError?.message);
  return message ? `message=${message}` : "attempt=unknown";
}

function lastToolArgsSignature(ctx: RunContext, toolName: string): string | undefined {
  const calls = scopedCallLog(ctx.session, ctx.taskId);
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const entry = calls[index];
    if (entry?.toolName !== toolName) continue;
    return JSON.stringify(normalizeArgValue(entry.args));
  }
  return undefined;
}

function normalizeArgValue(value: unknown): unknown {
  if (typeof value === "string") return normalizeFailureMessage(value);
  if (Array.isArray(value)) return value.map((entry) => normalizeArgValue(entry));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of entries) normalized[key] = normalizeArgValue(entry);
    return normalized;
  }
  return value;
}

function normalizeFailureMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}
