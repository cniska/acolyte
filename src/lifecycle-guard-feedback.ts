import type { LifecycleFeedback } from "./lifecycle-contract";
import type { GuardEvent } from "./tool-guards";

type GuardFeedbackFactory = (event: GuardEvent, mode: LifecycleFeedback["mode"]) => LifecycleFeedback;

function createGuardFeedback(
  mode: LifecycleFeedback["mode"],
  input: Omit<LifecycleFeedback, "source" | "mode">,
): LifecycleFeedback {
  return { source: "guard", mode, ...input };
}

const guardFeedbackFactories = {
  "duplicate-call": (event, mode) =>
    createGuardFeedback(mode, {
      summary: `The previous ${event.toolName} call already used these arguments.`,
      instruction: "Reuse the earlier result or change approach instead of repeating the same call.",
    }),
  "file-churn": (event, mode) =>
    createGuardFeedback(mode, {
      summary:
        event.toolName === "file-read"
          ? `You have already revisited "${event.detail ?? "this file"}" multiple times without making progress.`
          : `You are stuck in a read/edit loop on "${event.detail ?? "this file"}".`,
      instruction:
        event.toolName === "file-read"
          ? "Use the content you already have, edit the file, or move to a different file."
          : "Use one consolidated edit or change approach instead of making another incremental pass.",
    }),
  "ping-pong": (event, mode) =>
    createGuardFeedback(mode, {
      summary: "You are alternating between the same tools without changing strategy.",
      details: event.detail ? `Recent calls are bouncing between ${event.detail}.` : undefined,
      instruction: "Stop repeating the same pattern. Change approach or change inputs.",
    }),
  "stale-result": (event, mode) =>
    createGuardFeedback(mode, {
      summary: `${event.toolName} is returning the same result repeatedly.`,
      instruction: "Do not repeat the same call again. Change inputs or use a different approach.",
    }),
  "redundant-search": (event, mode) =>
    createGuardFeedback(mode, {
      summary: `A previous ${event.toolName} call already covered this discovery step.`,
      instruction: "Stop repeating search variants. Read a relevant file directly or conclude from current evidence.",
    }),
  "redundant-find": (event, mode) =>
    createGuardFeedback(mode, {
      summary: `A previous ${event.toolName} call already covered this discovery step.`,
      instruction: "Reuse the broader result or read a promising file directly.",
    }),
  "post-edit-redundancy": (event, mode) =>
    createGuardFeedback(mode, {
      summary: `A previous edit already changed "${event.detail ?? "this file"}".`,
      instruction: "Do not undo or discard the file after a successful edit. Keep it and revise it in place if needed.",
    }),
  "verify-rediscovery": (event) =>
    createGuardFeedback("verify", {
      summary: `Verify already has enough evidence for "${event.detail ?? "this file"}".`,
      instruction:
        "Do not rediscover that edited file in verify mode. Conclude from code-scan, test-run, and the existing edit preview.",
    }),
} satisfies Record<string, GuardFeedbackFactory>;

type SupportedGuardId = keyof typeof guardFeedbackFactories;

function isSupportedGuardId(guardId: string): guardId is SupportedGuardId {
  return guardId in guardFeedbackFactories;
}

/**
 * Lifecycle only surfaces selected guard blocks back to the model.
 * Most guard events remain internal runtime signals and never become feedback.
 */
export function createLifecycleFeedbackForGuard(
  event: GuardEvent,
  mode: LifecycleFeedback["mode"],
): LifecycleFeedback | undefined {
  if (event.action !== "blocked") return undefined;
  if (!isSupportedGuardId(event.guardId)) return undefined;
  const factory = guardFeedbackFactories[event.guardId];
  return factory(event, mode);
}
