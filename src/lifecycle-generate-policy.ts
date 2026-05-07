import type { LanguageModelV3Message } from "@ai-sdk/provider";
import type { LifecycleSignal } from "./agent-contract";
import { wrapInSystemReminder } from "./agent-reminders-render";
import { unreachable } from "./assert";
import { LIFECYCLE_ERROR_CODES } from "./error-contract";
import type { CompletionBlock } from "./lifecycle-completion";
import { SELF_REVIEW_TURNS_COOLDOWN } from "./lifecycle-constants";

const MISSING_SIGNAL_MESSAGE =
  "Cannot finish yet: final responses must call exactly one lifecycle signal tool (`signal_done`, `signal_noop`, or `signal_blocked`).";

const SELF_REVIEW_MESSAGE = [
  "Before finishing, review the original task you were given.",
  "In one sentence, confirm what you completed.",
  "If anything requested is still outstanding — files not updated, tests not added, steps skipped — address it now rather than handing off silently.",
].join(" ");

export type FinishPolicyState = {
  completionRetryUsed: boolean;
  missingSignalRetryUsed: boolean;
  selfReviewTurnsRemaining: number;
};

export type FinishPolicyDecision =
  | { kind: "none" }
  | { kind: "missing-signal-continue"; message: string }
  | { kind: "missing-signal-block"; message: string; code: typeof LIFECYCLE_ERROR_CODES.unknown }
  | { kind: "self-review-inject" }
  | { kind: "self-review-skip"; reason: "no-writes" }
  | { kind: "completion-rejected-continue"; block: CompletionBlock };

export function createFinishPolicyState(selfReviewTurnsRemaining = SELF_REVIEW_TURNS_COOLDOWN): FinishPolicyState {
  return {
    completionRetryUsed: false,
    missingSignalRetryUsed: false,
    selfReviewTurnsRemaining,
  };
}

export function decideFinish(input: {
  state: FinishPolicyState;
  signal?: LifecycleSignal;
  hasWrites: boolean;
  completionBlock?: CompletionBlock;
}): FinishPolicyDecision {
  if (!input.signal) {
    if (!input.state.missingSignalRetryUsed) {
      input.state.missingSignalRetryUsed = true;
      return { kind: "missing-signal-continue", message: MISSING_SIGNAL_MESSAGE };
    }
    return { kind: "missing-signal-block", message: MISSING_SIGNAL_MESSAGE, code: LIFECYCLE_ERROR_CODES.unknown };
  }

  if (input.signal === "done" && input.state.selfReviewTurnsRemaining > 0) {
    input.state.selfReviewTurnsRemaining = 0;
    if (!input.hasWrites) return { kind: "self-review-skip", reason: "no-writes" };
    return { kind: "self-review-inject" };
  }

  if (input.completionBlock && !input.state.completionRetryUsed) {
    input.state.completionRetryUsed = true;
    return { kind: "completion-rejected-continue", block: input.completionBlock };
  }

  return { kind: "none" };
}

export function renderFinishPolicyMessages(decision: FinishPolicyDecision): LanguageModelV3Message[] {
  switch (decision.kind) {
    case "missing-signal-continue":
      return [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: wrapInSystemReminder(
                "missing-signal",
                `${decision.message} Continue by calling the correct signal tool now.`,
              ),
            },
          ],
        },
      ];
    case "self-review-inject":
      return [
        {
          role: "user",
          content: [{ type: "text", text: wrapInSystemReminder("task-self-review", SELF_REVIEW_MESSAGE) }],
        },
      ];
    case "completion-rejected-continue":
      return [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: wrapInSystemReminder(
                "completion-rejected",
                [
                  decision.block.message,
                  "Continue autonomously: run focused validation now, or call `signal_blocked` only if validation is genuinely impossible.",
                ].join(" "),
              ),
            },
          ],
        },
      ];
    case "missing-signal-block":
    case "self-review-skip":
    case "none":
      return [];
    default:
      return unreachable(decision);
  }
}
