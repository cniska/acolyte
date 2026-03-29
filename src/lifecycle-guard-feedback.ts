import type { LifecycleFeedback } from "./lifecycle-contract";
import type { GuardEvent } from "./tool-guards";

type GuardFeedbackFactory = (event: GuardEvent) => LifecycleFeedback;

function createGuardFeedback(input: Omit<LifecycleFeedback, "source">): LifecycleFeedback {
  return { source: "guard", ...input };
}

const guardFeedbackFactories = {
  "duplicate-call": (event) =>
    createGuardFeedback({
      summary: `The previous ${event.toolName} call already used these arguments.`,
      instruction: "Reuse the earlier result or change approach instead of repeating the same call.",
    }),
  "file-churn": (event) =>
    createGuardFeedback({
      summary:
        event.toolName === "file-read"
          ? `You have already revisited "${event.detail ?? "this file"}" multiple times without making progress.`
          : `You are stuck in a read/edit loop on "${event.detail ?? "this file"}".`,
      instruction:
        event.toolName === "file-read"
          ? "Use the content you already have, edit the file, or move to a different file."
          : "Use one consolidated edit or change approach instead of making another incremental pass.",
    }),
  "ping-pong": () =>
    createGuardFeedback({
      summary: "You are alternating between the same tools without changing strategy.",
      instruction: "Stop repeating the same pattern. Change approach or change inputs.",
    }),
  "stale-result": (event) =>
    createGuardFeedback({
      summary: `${event.toolName} is returning the same result repeatedly.`,
      instruction: "Do not repeat the same call again. Change inputs or use a different approach.",
    }),
  "redundant-search": (event) =>
    createGuardFeedback({
      summary: `A previous ${event.toolName} call already covered this discovery step.`,
      instruction: "Stop repeating search variants. Read a relevant file directly or conclude from current evidence.",
    }),
  "redundant-find": (event) =>
    createGuardFeedback({
      summary: `A previous ${event.toolName} call already covered this discovery step.`,
      instruction: "Reuse the broader result or read a promising file directly.",
    }),
  "post-edit-redundancy": (event) =>
    createGuardFeedback({
      summary: `A previous edit already changed "${event.detail ?? "this file"}".`,
      instruction: "Do not undo or discard the file after a successful edit. Keep it and revise it in place if needed.",
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
export function createLifecycleFeedbackForGuard(event: GuardEvent): LifecycleFeedback | undefined {
  if (event.action !== "blocked") return undefined;
  if (!isSupportedGuardId(event.guardId)) return undefined;
  const factory = guardFeedbackFactories[event.guardId];
  return factory(event);
}
